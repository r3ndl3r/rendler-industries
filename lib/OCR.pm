# /lib/OCR.pm
package OCR;

use strict;
use warnings;
use utf8;
use File::Temp qw(tempfile);
use Mojo::Util qw(trim);

# Optical Character Recognition and Receipt Parsing Service.
# Features:
#   - Image pre-processing via ImageMagick (Grayscale, Deskew, Threshold)
#   - Text extraction via Tesseract OCR
#   - Heuristic parsing for Store Name, Date, and Total Amount
# Integration points:
#   - Relies on external 'convert' and 'tesseract' binaries
#   - Used by Receipts controller for automated metadata tagging

# Processes a raw image BLOB and returns extracted metadata.
# Parameters:
#   image_data : Binary content of the receipt
# Returns:
#   HashRef containing:
#     store_name   : Detected merchant
#     receipt_date : Detected date (YYYY-MM-DD)
#     total_amount : Detected decimal value
#     raw_text     : Full OCR output
sub process_receipt {
    my ($class, $image_data) = @_;

        # 1. Create temporary files for processing
        # Use UNLINK => 1 to ensure cleanup on script exit/crash
        # Note: We remove specific SUFFIX from input to let ImageMagick detect format via magic bytes
        my ($fh_in, $fname_in)   = tempfile(UNLINK => 1);
        my ($fh_out, $fname_out) = tempfile(SUFFIX => '.jpg', UNLINK => 1);
        
        binmode($fh_in);
        print $fh_in $image_data;
        close($fh_in);
    
    # 2. Pre-process and OCR with primary method (V5: Sharpened)
    my $ocr_base = $fname_out;
    $ocr_base =~ s/\.jpg$//;

    my $data = $class->_execute_ocr($fname_in, $fname_out, $ocr_base, 
        ["-colorspace", "gray", "-unsharp", "0x5+1.0+0.05", "-deskew", "40%", "-threshold", "50%"]);

    # 3. Fallback: If critical data is missing, try secondary method (V4: Resized)
    # This helps with small text or slight distortions like 3 vs 8
    if (!$data->{receipt_date} || !$data->{total_amount}) {
        my $fallback_data = $class->_execute_ocr($fname_in, $fname_out, $ocr_base,
            ["-resize", "200%", "-colorspace", "gray", "-deskew", "40%", "-threshold", "50%"]);
        
        # Merge results: only fill in missing fields
        $data->{store_name}   ||= $fallback_data->{store_name};
        $data->{receipt_date} ||= $fallback_data->{receipt_date};
        $data->{total_amount} ||= $fallback_data->{total_amount};
        $data->{raw_text} .= "\n--- FALLBACK OCR OUTPUT ---\n" . $fallback_data->{raw_text};
    }

    return $data;
}

# Internal helper to execute ImageMagick + Tesseract + Parsing
sub _execute_ocr {
    my ($class, $fname_in, $fname_out, $ocr_base, $flags) = @_;
    
    system("convert", $fname_in, @$flags, "jpg:$fname_out");
    system("tesseract", $fname_out, $ocr_base, "--psm", "6", "--oem", "1", "quiet");

    my $txt_file = $ocr_base . ".txt";
    my $raw_text = "";
    if (-f $txt_file) {
        open my $fh, "<:utf8", $txt_file;
        $raw_text = do { local $/; <$fh> };
        close $fh;
        unlink($txt_file);
    }

    my $data = $class->parse_text($raw_text);
    $data->{raw_text} = $raw_text;
    return $data;
}

# Extracts structured data from raw OCR text using regex heuristics.
# Parameters:
#   text : String of extracted text
# Returns:
#   HashRef with store_name, receipt_date, and total_amount
sub parse_text {
    my ($class, $text) = @_;
    my @lines = grep { trim($_) ne '' } split(/\n/, $text);

    my $data = {
        store_name   => undef,
        receipt_date => undef,
        total_amount => undef,
    };

    return $data unless @lines;

    # 1. Store Name Heuristic: Priority Search
    # Map common partial/mangled strings to clean names
    my %store_map = (
        # Supermarkets
        'ALDI'             => 'ALDI',
        'COLES'            => 'Coles',
        'WOOLWORTHS'       => 'Woolworths',
        'worths'           => 'Woolworths',
        'W00LW0RTHS'       => 'Woolworths',
        'IGA'              => 'IGA',
        'FOODWORKS'        => 'Foodworks',
        'HARRIS FARM'      => 'Harris Farm',
        'COSTCO'           => 'Costco',
        'SPUDSHED'         => 'Spudshed',

        # Department & Variety
        'KMART'            => 'Kmart',
        'TARGET'           => 'Target',
        'BIG W'            => 'Big W',
        'MYER'             => 'Myer',
        'DAVID JONES'      => 'David Jones',
        'REJECT SHOP'      => 'Reject Shop',
        'DAISO'            => 'Daiso',
        'MINISO'           => 'Miniso',
        'TK MAXX'          => 'TK Maxx',

        # Hardware & Auto
        'BUNNINGS'         => 'Bunnings',
        'MITRE 10'         => 'Mitre 10',
        'HOME HARDWARE'    => 'Home Hardware',
        'TOTAL TOOLS'      => 'Total Tools',
        'SYDNEY TOOLS'     => 'Sydney Tools',
        'SUPERCHEAP AUTO'  => 'Supercheap Auto',
        'REPCO'            => 'Repco',
        'AUTOBARN'         => 'Autobarn',

        # Electronics & Office
        'JB HI-FI'         => 'JB Hi-Fi',
        'JB HIFI'          => 'JB Hi-Fi',
        'HARVEY NORMAN'    => 'Harvey Norman',
        'THE GOOD GUYS'    => 'The Good Guys',
        'OFFICEWORKS'      => 'Officeworks',
        'BING LEE'         => 'Bing Lee',

        # Pharmacy & Health
        'CHEMIST WAREHOUSE'=> 'Chemist Warehouse',
        'CHEMIST'          => 'Chemist Warehouse',
        'PRICELINE'        => 'Priceline',
        'TERRYWHITE'       => 'TerryWhite Chemmart',

        # Liquor
        'DAN MURPHY'       => 'Dan Murphy\'s',
        'BWS'              => 'BWS',
        'LIQUORLAND'       => 'Liquorland',
        'VINTAGE CELLARS'  => 'Vintage Cellars',
        'FIRST CHOICE'     => 'First Choice',

        # Convenience & Fuel
        '7-ELEVEN'         => '7-Eleven',
        '7 ELEVEN'         => '7-Eleven',
        'AMPOL'            => 'Ampol',
        'CALTEX'           => 'Ampol',
        'BP '              => 'BP',
        'SHELL'            => 'Shell',
        'VIVA ENERGY'      => 'Shell',
        'UNITED PETROLEUM' => 'United',
        'LIBERTY'          => 'Liberty',
        'EG AMPOL'         => 'EG Ampol',
        'EXPRESS'          => 'Coles Express',

        # Clothing & Sports
        'REBEL'            => 'Rebel Sport',
        'BCF'              => 'BCF',
        'ANACONDA'         => 'Anaconda',
        'KATHMANDU'        => 'Kathmandu',
        'UNIQLO'           => 'Uniqlo',
        'COTTON ON'        => 'Cotton On',

        # Known Locations (Fallback to specific stores)
        'BURWOOD EAST'     => 'ALDI',
        'FOREST HILL'      => 'ALDI',
    );

    # Search ALL lines for any prioritized keyword
    # We prioritize longer matches (like Coles Express over Coles)
    STORE_SEARCH: for my $line (@lines) {
        my $clean_line = uc(trim($line));
        foreach my $key (sort { length($b) <=> length($a) } keys %store_map) {
            if ($clean_line =~ /\b$key\b/i || $clean_line =~ /^$key/i) {
                $data->{store_name} = $store_map{$key};
                last STORE_SEARCH;
            }
        }
    }

    # Fallback: First valid-looking word in top 5 lines
    unless ($data->{store_name}) {
        for my $line (@lines[0..4]) {
            my $cleaned = trim($line);
            # Filter out common non-store headers
            next if $cleaned =~ /Invoice|Tax|Receipt|\$\$|^ABN|^[^\w\s]+$|^\d+$/i;
            next if length($cleaned) < 3;
            if (my ($word) = $cleaned =~ /^([A-Za-z\&\'\s]{3,20})/ ) {
                $data->{store_name} = trim($word);
                last;
            }
        }
    }

    # 2. Total Amount Heuristic: Bottom-Up Search
    # Improved regex to handle $ symbols, spaces, and varied labels
    # Look for patterns like "TOTAL $ 12.34" or "AMOUNT: 12.34"
    my @amounts;
    while ($text =~ /(?:TOTAL|AMOUNT|BAL|DUE|AUD|Card Sales|EFT|SUBTOTAL|PAYABLE|PAID)\s*[:\$]*\s*([0-9]{1,4}[\.,][0-9]{2})/gi) {
        push @amounts, $1;
    }
    
    # Also look for standalone numbers at the end of the text if no keywords matched
    if (!@amounts) {
        while ($text =~ /\s*([0-9]{1,4}[\.,][0-9]{2})\s*$/gm) {
            push @amounts, $1;
        }
    }

    if (@amounts) {
        # Take the largest amount found, as the total is usually the maximum value on the receipt
        my @sorted_amounts = sort { $b <=> $a } map { s/,/./; $_ } @amounts;
        $data->{total_amount} = $sorted_amounts[0];
    }

    # 3. Date Heuristic: Standard Formats
    # Support DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, and YYYY-MM-DD
    my @dates;
    
    # Standard formats: DD/MM/YYYY or DD-MM-YYYY
    while ($text =~ m|\b(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{2,4})\b|g) {
        my ($d, $m, $y) = ($1, $2, $3);
        next if $m > 12 || $d > 31;
        $y = "20$y" if length($y) == 2;
        push @dates, sprintf("%04d-%02d-%02d", $y, $m, $d);
    }
    
    # Named months: 12 Jan 2024
    while ($text =~ /\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})\b/gi) {
        my ($d, $mon, $y) = ($1, uc(substr($2, 0, 3)), $3);
        my %months = (JAN=>1,FEB=>2,MAR=>3,APR=>4,MAY=>5,JUN=>6,JUL=>7,AUG=>8,SEP=>9,OCT=>10,NOV=>11,DEC=>12);
        $y = "20$y" if length($y) == 2;
        push @dates, sprintf("%04d-%02d-%02d", $y, $months{$mon}, $d);
    }
    
    if (@dates) {
        require Time::Piece;

        my $now   = Time::Piece->new;
        my $today = $now->strftime('%Y-%m-%d');

        # Receipts older than 10 years are almost certainly parse errors.
        # Combined with the future check this defines the plausibility window.
        my $oldest = sprintf('%04d-%02d-%02d', $now->year - 10, $now->mon, $now->mday);

        # Validates against the calendar (catches impossible dates like Feb 30 or
        # Apr 31 via strptime dying on them) and the plausibility window.
        my $is_plausible = sub {
            my $str = shift;
            return 0 if $str gt $today || $str lt $oldest;
            eval { Time::Piece->strptime($str, '%Y-%m-%d') };
            return $@ ? 0 : 1;
        };

        # 1. Walk all parsed candidates in document order — receipt dates appear
        #    near the top so the first plausible hit is almost always correct.
        my ($date) = grep { $is_plausible->($_) } @dates;

        # 2. No valid candidate found — apply systematic OCR digit correction to
        #    each future-dated candidate. Pairs map commonly misread digits to their
        #    most likely true value. Only the day component is corrected; month and
        #    year misreads are rarer and carry a higher risk of a wrong correction.
        #    Candidates are tried nearest-to-today first to maximise accuracy.
        unless ($date) {
            my @ocr_pairs = (['8','3'], ['7','1'], ['6','0'], ['9','4'], ['1','7'], ['0','6']);

            CANDIDATE: for my $raw (sort { $a cmp $b } grep { $_ gt $today } @dates) {
                my ($y, $m, $d) = split(/-/, $raw);
                for my $pair (@ocr_pairs) {
                    my ($wrong, $right) = @$pair;
                    (my $fixed_d = $d) =~ s/$wrong/$right/g;
                    next if $fixed_d eq $d;
                    my $fixed = sprintf('%04d-%02d-%02d', $y, $m, $fixed_d);
                    if ($is_plausible->($fixed)) {
                        $date = $fixed;
                        last CANDIDATE;
                    }
                }
            }
        }

        # Only assign if we ended up with something trustworthy — leaving it undef
        # is safer than storing a date we have low confidence in.
        $data->{receipt_date} = $date if $date;
    }

    return $data;
}

1;

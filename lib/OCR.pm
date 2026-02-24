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
    
        # 2. Pre-process image via ImageMagick
        # -colorspace gray  : Remove color noise
        # -deskew 40%       : Straighten tilted receipts
        # -lat 25x25+10%    : Local Adaptive Thresholding for uneven lighting
        # -negate           : Ensure black text on white background (if LAT flipped it)
        # We specify the output format explicitly as JPG for Tesseract
        system("convert", $fname_in, "-colorspace", "gray", "-deskew", "40%", "-lat", "25x25+10%", "-negate", "jpg:$fname_out");
    

    # 3. Perform OCR via Tesseract
    # Tesseract output filename appends .txt automatically
    # --psm 6 : Assume a single uniform block of text.
    # --oem 1 : Use LSTM OCR engine for better accuracy.
    my $ocr_base = $fname_out;
    $ocr_base =~ s/\.jpg$//;
    system("tesseract", $fname_out, $ocr_base, "--psm", "6", "--oem", "1", "quiet");

    my $txt_file = $ocr_base . ".txt";
    my $raw_text = "";
    if (-f $txt_file) {
        open my $fh, "<:utf8", $txt_file;
        $raw_text = do { local $/; <$fh> };
        close $fh;
        unlink($txt_file); # Manual cleanup of the text file
    }

    # 4. Parse metadata from raw text
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
        'ALDI'         => 'ALDI',
        'COLES'        => 'Coles',
        'WOOLWORTHS'   => 'Woolworths',
        'worths'       => 'Woolworths',
        'W00LW0RTHS'   => 'Woolworths', # Common OCR error
        'COSTCO'       => 'Costco',
        'KMART'        => 'Kmart',
        'TARGET'       => 'Target',
        'BUNNINGS'     => 'Bunnings',
        'IGA'          => 'IGA',
        '7-ELEVEN'     => '7-Eleven',
        'REJECT SHOP'  => 'Reject Shop',
        'OFFICEWORKS'  => 'Officeworks',
        'DAISO'        => 'Daiso',
        'CHEMIST'      => 'Chemist Warehouse',
        'BURWOOD EAST' => 'ALDI',
        'FOREST HILL'  => 'ALDI',
    );

    # Search ALL lines for any prioritized keyword
    STORE_SEARCH: for my $line (@lines) {
        my $clean_line = uc(trim($line));
        for my $key (keys %store_map) {
            if ($clean_line =~ /\b$key\b/i) {
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
        # Take the most recent date found if multiple exist (unlikely but safer)
        my @sorted_dates = sort { $b cmp $a } @dates;
        $data->{receipt_date} = $sorted_dates[0];
    }

    return $data;
}

1;

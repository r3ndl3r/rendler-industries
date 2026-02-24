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
    my ($fh_in, $fname_in)   = tempfile(SUFFIX => '.jpg', UNLINK => 1);
    my ($fh_out, $fname_out) = tempfile(SUFFIX => '.jpg', UNLINK => 1);
    
    binmode($fh_in);
    print $fh_in $image_data;
    close($fh_in);

    # 2. Pre-process image via ImageMagick
    # -colorspace gray : Remove color noise
    # -deskew 40%      : Straighten tilted receipts
    # -threshold 50%   : Convert to high-contrast B&W for Tesseract
    system("convert", $fname_in, "-colorspace", "gray", "-deskew", "40%", "-threshold", "50%", $fname_out);

    # 3. Perform OCR via Tesseract
    # Tesseract output filename appends .txt automatically
    my $ocr_base = $fname_out;
    $ocr_base =~ s/\.jpg$//;
    system("tesseract", $fname_out, $ocr_base, "--psm", "6", "quiet");

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
    my @lines = grep { trim($_) ne '' } split(/
/, $text);

    my $data = {
        store_name   => undef,
        receipt_date => undef,
        total_amount => undef,
    };

    # Store Name Heuristic: Usually the first non-empty line
    if (@lines) {
        # Common store keywords to look for
        my $keywords = qr/ALDI|COLES|WOOLWORTHS|COSTCO|KMART|TARGET|BUNNINGS|IGA|7-ELEVEN/i;

        for my $line (@lines[0..5]) {
            my $cleaned = trim($line);
            next if $cleaned =~ /Invoice|Tax|Receipt|\$\$|^ABN|^[^\w\s]+$/i;
            
            # Skip noise like "os, aan" (too short or mostly symbols)
            my $alnum_count = () = $cleaned =~ /[a-zA-Z0-9]/g;
            next if length($cleaned) < 3 || $alnum_count < (length($cleaned) / 2);

            # If it matches a known store, we're very confident
            if ($cleaned =~ $keywords) {
                # Extract only the first word (e.g. "ALDI" from "ALDI STORES")
                my ($first_word) = $cleaned =~ /^(\w+)/;
                $data->{store_name} = $first_word || $cleaned;
                last;
            }

            # Otherwise, take the first valid-looking line if we haven't found one yet
            my ($first_word) = $cleaned =~ /^(\w+)/;
            $data->{store_name} ||= $first_word || $cleaned;
        }
    }

    # Total Amount Heuristic
    # Look for keywords like TOTAL or AMOUNT followed by a decimal price
    if ($text =~ /(?:TOTAL|AMOUNT|BAL|DUE|AUD)\s*[:\$]*\s*(\d+[\.,]\d{2})/i) {
        $data->{total_amount} = $1;
        $data->{total_amount} =~ s/,/./; # Standardize decimal point
    }

    # Date Heuristic
    # Support DD/MM/YY, DD/MM/YYYY, DD.MM.YY, DD-MM-YY
    if ($text =~ m|(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{2,4})|) {
        my ($d, $m, $y) = ($1, $2, $3);
        $y = "20$y" if length($y) == 2; # Heuristic: Assume 21st century
        $data->{receipt_date} = sprintf("%04d-%02d-%02d", $y, $m, $d);
    } 
    # Support 22FEB26 style found in the test run
    elsif ($text =~ /(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})/i) {
        my ($d, $mon, $y) = ($1, uc($2), $3);
        my %months = (JAN=>1,FEB=>2,MAR=>3,APR=>4,MAY=>5,JUN=>6,JUL=>7,AUG=>8,SEP=>9,OCT=>10,NOV=>11,DEC=>12);
        $y = "20$y" if length($y) == 2;
        $data->{receipt_date} = sprintf("%04d-%02d-%02d", $y, $months{$mon}, $d);
    }

    return $data;
}

1;

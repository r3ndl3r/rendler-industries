# /lib/MyApp/Plugin/OCR.pm

package MyApp::Plugin::OCR;

use Mojo::Base 'Mojolicious::Plugin';
use File::Temp qw(tempfile);
use Mojo::Util qw(trim);
use strict;
use warnings;
use utf8;

# Optical Character Recognition and Receipt Parsing Service Plugin.
# Features:
#   - Image pre-processing via ImageMagick (Grayscale, Deskew, Threshold)
#   - Text extraction via Tesseract OCR
#   - Heuristic parsing for Store Name, Date, and Total Amount
#
# Integration points:
#   - Registers global helper '$c->ocr_process($blob)' in Mojolicious.
#   - Relies on external 'convert' and 'tesseract' binaries.
#   - Logs process errors to the application logger.

sub register {
    my ($self, $app, $config) = @_;

    $app->helper(ocr_process => sub {
        my ($c, $image_data) = @_;

        # 1. Create temporary files for processing
        my ($fh_in, $fname_in)   = tempfile(UNLINK => 1);
        my ($fh_out, $fname_out) = tempfile(SUFFIX => '.jpg', UNLINK => 1);
        
        binmode($fh_in);
        print $fh_in $image_data;
        close($fh_in);
    
        # 2. Pre-process and OCR with primary method (Sharpened)
        my $ocr_base = $fname_out;
        $ocr_base =~ s/\.jpg$//;

        my $data = $self->_execute_ocr($c, $fname_in, $fname_out, $ocr_base, 
            ["-colorspace", "gray", "-unsharp", "0x5+1.0+0.05", "-deskew", "40%", "-threshold", "50%"]);

        # 3. Fallback: If critical data is missing, try secondary method (Resized)
        if (!$data->{receipt_date} || !$data->{total_amount}) {
            my $fallback_data = $self->_execute_ocr($c, $fname_in, $fname_out, $ocr_base,
                ["-resize", "200%", "-colorspace", "gray", "-deskew", "40%", "-threshold", "50%"]);
            
            # Merge results: only fill in missing fields
            $data->{store_name}   ||= $fallback_data->{store_name};
            $data->{receipt_date} ||= $fallback_data->{receipt_date};
            $data->{total_amount} ||= $fallback_data->{total_amount};
            $data->{raw_text} .= "
--- FALLBACK OCR OUTPUT ---
" . $fallback_data->{raw_text};
        }

        return $data;
    });
}

sub _execute_ocr {
    my ($self, $c, $fname_in, $fname_out, $ocr_base, $flags) = @_;
    
    # Run ImageMagick
    if (system("convert", $fname_in, @$flags, "jpg:$fname_out") != 0) {
        $c->app->log->error("OCR: ImageMagick 'convert' failed: $!");
    }

    # Run Tesseract
    if (system("tesseract", $fname_out, $ocr_base, "--psm", "6", "--oem", "1", "quiet") != 0) {
        $c->app->log->error("OCR: Tesseract execution failed: $!");
    }

    my $txt_file = $ocr_base . ".txt";
    my $raw_text = "";
    if (-f $txt_file) {
        open my $fh, "<:utf8", $txt_file;
        $raw_text = do { local $/; <$fh> };
        close $fh;
        unlink($txt_file);
    }

    my $data = $self->parse_text($raw_text);
    $data->{raw_text} = $raw_text;
    return $data;
}

sub parse_text {
    my ($self, $text) = @_;
    my @lines = grep { trim($_) ne '' } split(/
/, $text);

    my $data = { store_name => undef, receipt_date => undef, total_amount => undef };
    return $data unless @lines;

    # --- Store Name Heuristics ---
    my %store_map = (
        'ALDI' => 'ALDI', 'COLES' => 'Coles', 'WOOLWORTHS' => 'Woolworths', 'worths' => 'Woolworths',
        'W00LW0RTHS' => 'Woolworths', 'IGA' => 'IGA', 'FOODWORKS' => 'Foodworks', 
        'KMART' => 'Kmart', 'TARGET' => 'Target', 'BIG W' => 'Big W', 'BUNNINGS' => 'Bunnings',
        '7-ELEVEN' => '7-Eleven', '7 ELEVEN' => '7-Eleven', 'AMPOL' => 'Ampol', 'CALTEX' => 'Ampol',
        'JB HI-FI' => 'JB Hi-Fi', 'CHEMIST WAREHOUSE'=> 'Chemist Warehouse', 'DAN MURPHY' => "Dan Murphy's",
    );

    STORE_SEARCH: for my $line (@lines) {
        my $clean_line = uc(trim($line));
        foreach my $key (sort { length($b) <=> length($a) } keys %store_map) {
            if ($clean_line =~ /\b$key\b/i || $clean_line =~ /^$key/i) {
                $data->{store_name} = $store_map{$key};
                last STORE_SEARCH;
            }
        }
    }

    # --- Total Amount Heuristics ---
    my @amounts;
    while ($text =~ /(?:TOTAL|AMOUNT|BAL|DUE|AUD|Card Sales|EFT|SUBTOTAL|PAYABLE|PAID)\s*[:\$]*\s*([0-9]{1,4}[\.,][0-9]{2})/gi) {
        push @amounts, $1;
    }
    if (@amounts) {
        my @sorted_amounts = sort { $b <=> $a } map { s/,/./; $_ } @amounts;
        $data->{total_amount} = $sorted_amounts[0];
    }

    # --- Date Heuristics ---
    my @dates;
    while ($text =~ m|\b(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{2,4})\b|g) {
        my ($d, $m, $y) = ($1, $2, $3);
        next if $m > 12 || $d > 31;
        $y = "20$y" if length($y) == 2;
        push @dates, sprintf("%04d-%02d-%02d", $y, $m, $d);
    }
    
    if (@dates) {
        require Time::Piece;
        my $now   = Time::Piece->new;
        my $today = $now->strftime('%Y-%m-%d');
        my $oldest = sprintf('%04d-%02d-%02d', $now->year - 10, $now->mon, $now->mday);

        my $is_plausible = sub {
            my $str = shift;
            return 0 if $str gt $today || $str lt $oldest;
            eval { Time::Piece->strptime($str, '%Y-%m-%d') };
            return $@ ? 0 : 1;
        };

        ($data->{receipt_date}) = grep { $is_plausible->($_) } @dates;
    }

    return $data;
}

1;

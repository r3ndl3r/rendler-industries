#!/usr/bin/perl -w
use FindBin;
use lib "$FindBin::Bin/lib";

# Start the application
require MyApp;
MyApp->new->start;

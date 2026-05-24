# /lib/MyApp/Plugin/Maintenance.pm

package MyApp::Plugin::Maintenance;

use strict;
use warnings;
use utf8;
use Mojo::Base 'Mojolicious::Plugin';
use Mojo::IOLoop;

# Built-in maintenance task manifest.
# Features:
#   - Seeds all first-party background tasks for fresh installs
#   - Synchronizes code-owned task metadata on startup
#   - Preserves admin-controlled enabled and interval settings
# Integration Points:
#   - Uses DB::Maintenance::sync_maintenance_manifest
#   - Task function names are implemented by MyApp::Controller::System
#   - Loaded automatically by MyApp.pm's plugin discovery
use constant MANIFEST => {
    automator_heartbeat => {
        label            => 'Automator Heartbeat',
        description      => 'Prunes stale running records if the background process has terminated.',
        function_name    => 'run_automator_heartbeat',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    automator_scheduler => {
        label            => 'Automator Scheduler',
        description      => 'Checks for due Ansible playbooks and spawns background runs.',
        function_name    => 'run_automator_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    brief_notification => {
        label            => 'Daily Brief',
        description      => 'Dispatches the 8 AM family overview. Self-gates to once per day via an atomic DB check.',
        function_name    => 'run_brief_notification',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    calendar_notifications => {
        label            => 'Calendar Notifications',
        description      => 'Notifies users of upcoming calendar events within their configured notification window.',
        function_name    => 'run_calendar_notifications',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    chore_reminders => {
        label            => 'Chore Reminders',
        description      => 'Nudges users about chores that have been pending for more than 60 minutes.',
        function_name    => 'run_chore_reminders',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    emoji_maintenance => {
        label            => 'Emoji Preprocessing',
        description      => 'Async subprocess: prepends emojis to tasks, shopping items, and calendar events via AI/dict.',
        function_name    => 'run_emoji_maintenance_p',
        is_async         => 1,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    login_security_cleanup => {
        label            => 'Login Security Cleanup',
        description      => 'Prunes expired login failure and lockout records.',
        function_name    => 'run_login_security_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 60,
    },
    meals_maintenance => {
        label            => 'Meals Maintenance',
        description      => 'Sends meal selection reminders at 8 AM and 12 PM; locks in selections at 2 PM.',
        function_name    => 'run_meals_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 0,
        interval_minutes => 1,
    },
    notes_lock => {
        label            => 'Notes Lock Cleanup',
        description      => 'Prunes abandoned collaborative note edit locks older than 5 minutes.',
        function_name    => 'run_notes_lock_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    notes_znorm => {
        label            => 'Notes Z-Index Reset',
        description      => 'Normalizes note z-indices on all whiteboards. Runs at 3 AM; leave interval at 1.',
        function_name    => 'run_notes_znorm_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    notification_queue => {
        label            => 'Notification Queue',
        description      => 'Processes queued Discord/Email deliveries with 3-retry fallback and admin alert on failure.',
        function_name    => 'run_notification_queue',
        is_async         => 0,
        run_last         => 1,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    reminder_maintenance => {
        label            => 'Reminder Dispatch',
        description      => 'Sends recurring reminders based on day-of-week and time rules.',
        function_name    => 'run_reminder_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    room_reminders => {
        label            => 'Room Reminders',
        description      => 'Sends daily room-cleaning reminders with feedback on previous attempts.',
        function_name    => 'run_room_reminders',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    timer_maintenance => {
        label            => 'Timer Maintenance',
        description      => 'Cleans expired sessions, updates running timers, sends warning and expiry notifications.',
        function_name    => 'run_timer_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    uno_cleanup => {
        label            => 'UNO Session Cleanup',
        description      => 'Removes stale UNO games: >1 h finished, >2 h lobbies, >4 h active.',
        function_name    => 'cleanup_stale_uno_sessions',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
    weather_maintenance => {
        label            => 'Weather Data Refresh',
        description      => 'Fetches fresh observation data from OpenWeatherMap for all active locations.',
        function_name    => 'run_weather_maintenance',
        is_async         => 0,
        run_last         => 0,
        is_enabled       => 1,
        interval_minutes => 1,
    },
};

sub register {
    my ($self, $app, $config) = @_;

    Mojo::IOLoop->next_tick(sub {
        eval { $app->db->sync_maintenance_manifest(MANIFEST); 1 }
            or $app->log->error("Maintenance manifest sync failed: $@");
    });
}

1;

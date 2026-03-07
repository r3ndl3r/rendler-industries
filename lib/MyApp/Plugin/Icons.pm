# /lib/MyApp/Plugin/Icons.pm

package MyApp::Plugin::Icons;
use Mojo::Base 'Mojolicious::Plugin';

# Centralized Icon Management Plugin
# Provides a helper to render standardized icons (currently emojis) across the application.
# Future-proofs the codebase for potential migration to SVG or FontAwesome.

sub register {
    my ($self, $app) = @_;

    # Map of semantic names to their display symbols
    my %icons = (
        # Actions
        'edit'      => '✎',
        'delete'    => '🗑️',
        'add'       => '➕',
        'save'      => '💾',
        'cancel'    => '❌',
        'view'      => '👁️',
        'copy'      => '📋',
        'check'     => '✅',
        'close'     => '×',
        'upload'    => '📤',
        'download'  => '📥',
        'settings'  => '⚙️',
        'bonus'     => '🎁',
        'crop'      => '✂️',
        'reset'     => '🔄',
        'vote'      => '👍',
        
        # Navigation / UI
        'home'      => '🏠',
        'menu'      => '☰',
        'user'      => '👤',
        'logout'    => '🚪',
        'search'    => '🔍',
        'back'      => '←',
        'clock'     => '🕒',
        'lock'      => '🔒',
        'calendar'  => '📅',
        'link'      => '🔗',
        'kangaroo'  => '🦘',
        'quick'     => '🚀',
        'uno'       => '🃏',
        'chess'     => '♟️',
        'chelsea'   => '🏖️',
        'phonebook' => '📞',
        'clipboard' => '📋',
        'login'     => '🔑',
        'register'  => '📝',
        'quiz'      => '❓',
        'admin'     => '🛡️',
        
        # Permissions
        'perm_admin'  => '🛡️',
        'perm_family' => '👨‍👩‍👧‍👦',
        'perm_user'   => '👤',
        'perm_guest'  => '🌍',
        
        # Modules
        'family'    => '👨‍👩‍👧‍👦',
        'shopping'  => '🛒',
        'todo'      => '✅',
        'timers'    => '⏱️',
        'birthdays' => '🎂',
        'swear'     => '🤬',
        'imposter'  => '🎭',
        'uno'       => '🃏',
        'connect4'      => '🔴',
        'connect4_blue' => '🔵',
        'chess'         => '♟️',
        'meals'         => '🍽️',
        'files'         => '📁',
        'receipts'  => '🧾',
        'reminders' => '🔔',
        'medication' => '💊',
        'ai'         => '🧠',
        
        # Device Categories
        'computer'       => '💻',
        'phone'          => '📱',
        'tablet'         => '📱',
        'gaming-console' => '🎮',
        'tv'             => '📺',
        
        # File Types
        'file_image'   => '🖼️',
        'file_pdf'     => '📄',
        'file_text'    => '📃',
        'file_archive' => '📦',
        'file_attach'  => '📎',
        
        # Notification Channels
        'discord'    => '💬',
        'email'      => '📧',
        'pushover'   => '⏱️',
        'gotify'     => '🔔',

        'expand'    => '▼',
        'collapse'  => '▲',
        'audio'     => '🔊',
        'shout'     => '📢',
        'idea'      => '💡',
        'draw'      => '🤝',
        'waiting'   => '⌛',
        'victory'   => '🎉',
        'loss'      => '💀',
        'trophy'    => '🏆',

        # Zodiac / Family Icons
        'andrea'    => '🐀',
        'nick'      => '🐉',
        'nicky'     => '🐉',
        'thararat'  => '🐎',
        'rendler'   => '🐓',
        
        # Status
        'warning'   => '⚠️',
        'info'      => 'ℹ️',
        'success'   => '✅',
        'error'     => '❌',
        'empty'     => '📭',
        'running'   => '▶️',
        'paused'    => '⏸️',
        'idle'      => '⏺️',
    );

    # Helper: icon('name')
    # Returns the icon string for a given semantic name.
    # Returns the name itself if not found (fallback).
    $app->helper(icon => sub {
        my ($c, $name) = @_;
        return $icons{lc($name)} // $name;
    });
}

1;
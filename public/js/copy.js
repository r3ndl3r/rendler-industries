/* /public/js/copy.js */

function textIn() {
    document.getElementById("paste").style.backgroundColor = "grey";
}

function removeMessage(id) {
    if (!confirm("Are you sure you want to delete this?")) return;
    
    $.post('/copy/delete/' + id, function() {
        location.reload();
    }).fail(function() {
        alert('Unauthorized: You are not allowed to delete messages.');
    });
}
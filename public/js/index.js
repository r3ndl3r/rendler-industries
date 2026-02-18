/* /public/js/index.js */

function toggleFileList() {
    const link = document.getElementById('listFilesLink');
    const box = document.getElementById('fileListBox');
    if (link && box) {
        link.style.display = 'none';
        
        box.style.display = 'block'; 
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (typeof upPage === 'function') {
        upPage();
    }
});
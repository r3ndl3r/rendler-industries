// /public/js/swear.js

function updateFine() {
    var select = document.getElementById('perp_select');
    var amountInput = document.getElementById('fine_amount');
    var selectedOption = select.options[select.selectedIndex];
    
    var fine = selectedOption.getAttribute('data-fine');
    if (fine && fine > 0) {
        amountInput.value = parseFloat(fine).toFixed(2);
    }
}
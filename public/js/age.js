// /public/js/age.js

function upIndex() {
    $.getJSON( 'age', function() { })
    .done(function(data) {
        document.getElementById('andrea').innerHTML = data.andrea;
        document.getElementById('nicky').innerHTML = data.nicky;
        document.getElementById('andreas').innerHTML = data.andreas;
        document.getElementById('nickys').innerHTML = data.nickys;
        document.getElementById('server').innerHTML = data.server;
        document.getElementById('servers').innerHTML = data.servers;
    });
}

function upValues() {
    document.getElementById('andreas').innerHTML++;
    document.getElementById('nickys').innerHTML++;
    document.getElementById('servers').innerHTML++;
}

function upPage() {
    upIndex();
    setInterval(function() {
        document.getElementById('time').innerHTML = moment(new Date).tz("Australia/Melbourne").format('dddd MMMM h:mm:ss a');
        upValues();
    }, 1000);
}

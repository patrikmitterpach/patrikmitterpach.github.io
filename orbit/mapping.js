import { getLatLngObj, getSatelliteInfo } from "./tle.js/index.mjs";

const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const icon = document.getElementById('icon')
const panel = document.getElementById('panel')

const lat_update = document.getElementById('latitude-update')
const lng_update = document.getElementById('longitude-update')
const vel_update = document.getElementById('velocity-update')
const hgt_update = document.getElementById('height-update')

const ctx = canvas.getContext('2d');

// How many minutes ahead or behind to display as dashed lines.
// 
// Note, lines_ahead only represents minutes when granularity
//  is set to 60 - 1 minute.
const lines_ahead = 60
const lines_behind = 60

// Each line represents the span of ${granularity} seconds
const granularity = 60 

// Technical global variables for counters and trackers
var previous_longitude = null

if (image.complete) {
    canvas.width = image.width;
    canvas.height = image.height;

    displayTLE();
}

function displayTLE(tle=null, time=Date.now()) {
    panel.style = "width: " + image.width + "px" 

    if (!tle) {
        tle = `ISS (ZARYA)
1 25544U 98067A   24321.20587963  .00018228  00000-0  32812-3 0  9992
2 25544  51.6409 282.2382 0007650 221.8173 321.1701 15.49845766482123`;
    }

    updateCounters(tle)

    const LatLanObj = getLatLngObj(tle)
    moveIcon(LatLanObj["lat"], LatLanObj["lng"])

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < lines_ahead; i++) {
        var coordinates = getLatLngObj(tle, Date.now()+(i * granularity * 1000))
        if (Math.abs(i) < 2) { previous_longitude = NaN; continue }

        drawPointByCoordinates(
            coordinates["lat"], coordinates["lng"], 6, false
        )
    }

    previous_longitude = NaN
    for (var i = 0; i > -lines_behind; i--) {
        var coordinates = getLatLngObj(tle, Date.now()+(i * granularity * 1000))

        if (Math.abs(i) < 2) { previous_longitude = NaN; continue }

        drawPointByCoordinates(
            coordinates["lat"], coordinates["lng"], 6, true
        )
    }
    previous_longitude = NaN

    
}

function updateCounters(tle) {
    info = getSatelliteInfo(tle)

    console.log(info)

    lat_update.textContent = info["lat"].toFixed(3);
    lng_update.textContent = info["lng"].toFixed(3);
    vel_update.textContent = info["velocity"].toFixed(3) + " km/s"
    hgt_update.textContent = info["height"].toFixed(3) + " km"

} 

function transformCoordinatesToPixels(latitude, longitude) {
    var mapWidth    = canvas.width; 
    var mapHeight   = canvas.height;

    // get x value
    var x = (longitude+180)*(mapWidth/360)

    // convert from degrees to radians
    var latRad = (latitude)*Math.PI/180;

    // get y value
    var mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    var y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));

    return {"x": x, "y": y}
}


function moveIcon(latitude, longitude) {
    // The following code assures the correct position of the satellite icon, as well
    //  as the correct position of the canvas, which is used for drawing the lines ahead and behind.
    

    const dimensions = transformCoordinatesToPixels(latitude, longitude)

    // Get coordinates relative to the viewport
    const rect = image.getBoundingClientRect();
    canvas.style.setProperty("top", rect.top+"px")
    icon.style.transform = `translate(${dimensions['x']-10+rect.left}px, ${dimensions['y']-10+rect.top}px)`;    
}

function drawPointByCoordinates(latitude, longitude, size=6, is_backwards=false) {
    const dimensions = transformCoordinatesToPixels(latitude, longitude)
    if (previous_longitude && (
            (!is_backwards && previous_longitude <= dimensions["x"]) || 
            ( is_backwards && previous_longitude >= dimensions["x"])
            )
        ) {
        ctx.lineTo(dimensions["x"], dimensions["y"])

        ctx.lineWidth = 2;
        ctx.strokeStyle = is_backwards ?  "#d1b187" : "#d2c9a5"  
        ctx.stroke();
        
        previous_longitude = NaN

    } else {
        ctx.beginPath();
        ctx.moveTo(dimensions["x"], dimensions["y"])
        previous_longitude = dimensions["x"]
    }
}

setInterval(displayTLE, 1000);
window.onresize = resize;
function resize() {
   displayTLE()
}


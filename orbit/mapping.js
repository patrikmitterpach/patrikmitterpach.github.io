import { getLatLngObj } from "./tle.js/index.mjs";

const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const icon = document.getElementById('icon')

const ctx = canvas.getContext('2d');

const LATITUDE_OFFSET = 0
const LONGITUDE_OFFSET = 0

var counter = 0
var previous_longitude = null

if (image.complete) {
    canvas.width = image.width;
    canvas.height = image.height;
}

image.onload = () => {
    canvas.width = image.width;
    canvas.height = image.height;

    displayTLE()
    // // Bratislava
    // drawPointByCoordinates(48.0991776, 16.9519043, 4)

    // // Buenos Aires
    // drawPointByCoordinates( -34.6483135,-58.579101, 4)

    // // Guinean Gulf
    // drawPointByCoordinates(0, 0, 4)
};

function displayTLE(tle=null, time=Date.now()) {

    if (!tle) {
        tle = `ISS (ZARYA)
1 25544U 98067A   24321.20587963  .00018228  00000-0  32812-3 0  9992
2 25544  51.6409 282.2382 0007650 221.8173 321.1701 15.49845766482123`;
    }

    const LatLanObj = getLatLngObj(tle)
    console.log(LatLanObj)

    moveIcon(LatLanObj["lat"], LatLanObj["lng"])

    
    // if (counter % 10 == 0) {
    if (counter % 10 == 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (var i = -93; i < 94; i++) {
            var coordinates = getLatLngObj(tle, Date.now()+(i*60000))
            if (Math.abs(i) < 2) { previous_longitude = NaN; continue }
    
            drawPointByCoordinates(
                coordinates["lat"], coordinates["lng"]
            )
        }
    }

    previous_longitude = NaN
    counter++;

}

function transformCoordinatesToPixels(latitude, longitude) {
    var mapWidth    = canvas.width; 
    var mapHeight   = canvas.height;

    // get x value
    var x = (longitude+180+LONGITUDE_OFFSET)*(mapWidth/360)

    // convert from degrees to radians
    var latRad = (latitude+LATITUDE_OFFSET)*Math.PI/180;

    // get y value
    var mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    var y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));

    return {"x": x, "y": y}
}


function moveIcon(latitude, longitude) {
    const dimensions = transformCoordinatesToPixels(latitude, longitude)
    icon.style.transform = `translate(${dimensions['x']-10}px, ${dimensions['y']-10}px)`;    
}

function drawPointByCoordinates(latitude, longitude, size=6) {
    // latitude    = 41.145556; // (φ)
    // longitude   = -73.995;   // (λ)
    
    const dimensions = transformCoordinatesToPixels(latitude, longitude)
    
    ctx.fillStyle = '#ae5d40';

    if (previous_longitude && previous_longitude <= dimensions["x"])  {
        ctx.lineTo(dimensions["x"], dimensions["y"])

        ctx.lineWidth = 2;
        ctx.strokeStyle = "#d1b187"
        ctx.stroke();
        
        previous_longitude = NaN

    } else {
        ctx.beginPath();
        ctx.moveTo(dimensions["x"], dimensions["y"])
        previous_longitude = dimensions["x"]
    }


    
}


console.log("hello")

setInterval(displayTLE, 1000);

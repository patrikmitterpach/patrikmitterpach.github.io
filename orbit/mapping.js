import { getLatLngObj } from "./tle.js/index.mjs";

const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

var icon = new Image();

icon.src = 'icon.svg';


const LATITUDE_OFFSET = 2.2
const LONGITUDE_OFFSET = -8.5

if (image.complete) {
    canvas.width = image.width;
    canvas.height = image.height;
}

image.onload = () => {
    canvas.width = image.width;
    canvas.height = image.height;
    // // Bratislava
    // drawPointByCoordinates(48.0991776, 16.9519043, 4)

    // // Buenos Aires
    // drawPointByCoordinates( -34.6483135,-58.579101, 4)

    // // Guinean Gulf
    // drawPointByCoordinates(0, 0, 4)
};

function displayTLE(tle) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!tle) {
        tle = `ISS (ZARYA)
1 25544U 98067A   24318.40073414  .00018836  00000-0  32023-3 0  9990
2 25544  51.6381 296.1395 0008363 170.0219 190.0938 15.51437269481692`;
    }

    const LatLanObj = getLatLngObj(tle)
    console.log(LatLanObj)

    drawPointByCoordinates(LatLanObj["lat"], LatLanObj["lng"], 1, icon)

}

function drawPointByCoordinates(latitude, longitude, size=6, img) {
    // latitude    = 41.145556; // (φ)
    // longitude   = -73.995;   // (λ)
    

    var mapWidth    = canvas.width; 
    var mapHeight   = canvas.height;

    // get x value
    var x = (longitude+180+LONGITUDE_OFFSET)*(mapWidth/360)

    // convert from degrees to radians
    var latRad = (latitude+LATITUDE_OFFSET)*Math.PI/180;

    // get y value
    var mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    var y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));
        
    ctx.fillStyle = '#ae5d40';
    ctx.beginPath();

    if (img) { ctx.drawImage(icon, x, y, 20, 20); }
    
    ctx.fill();
}


console.log("hello")
drawPointByCoordinates(0, 0, 4)

setInterval(displayTLE, 1000);

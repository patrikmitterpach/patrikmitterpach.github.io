import { getLatLngObj, getSatelliteInfo } from "./tle.js/index.mjs";

var TLE = `ISS (ZARYA)
1 25544U 98067A   24321.20587963  .00018228  00000-0  32812-3 0  9992
2 25544  51.6409 282.2382 0007650 221.8173 321.1701 15.49845766482123`;
    

const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const icon = document.getElementById('icon')
const panel = document.getElementById('panel')

const button = document.getElementById('tle-button')
const input = document.getElementById('tle-input')

const minutes = document.getElementById('minutes')

const lat_update = document.getElementById('latitude-update')
const lng_update = document.getElementById('longitude-update')
const vel_update = document.getElementById('velocity-update')
const hgt_update = document.getElementById('height-update')

const gs_lat = document.getElementById('gs-latitude')
const gs_lon = document.getElementById('gs-longitude')
const gs_ran = document.getElementById('gs-range')


const ctx = canvas.getContext('2d');

// How many minutes ahead or behind to display as dashed lines.
// 
// Note, lines_ahead only represents minutes when granularity
//  is set to 60 - 1 minute.
var lines_ahead = 120

// Each line represents the span of ${granularity} seconds
const granularity = 30 

// Technical global variables for counters and trackers
var previous_longitude = null

var max_latitude = 91;


if (image.complete) {
    canvas.width = image.width;
    canvas.height = image.height;

    displayTLE();
}

function displayTLE(update_counters=true, time=Date.now()) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    panel.style = "width: " + image.width + "px" 

    updateGroundCenter()
    if (update_counters) {
        updateCounters(TLE)
    }

    const LatLanObj = getLatLngObj(TLE)
    moveIcon(LatLanObj["lat"], LatLanObj["lng"])


    previous_longitude = NaN
    for (var i = 1; i < lines_ahead; i++) {
        // console.log("drawing line")
        var coordinates = getLatLngObj(TLE, Date.now()+(i * granularity * 1000))
        

        drawPointByCoordinates(
            coordinates["lat"], coordinates["lng"], 7, false
        )
    }

    previous_longitude = NaN
    for (var i = -2; i > -lines_ahead; i--) {
        var coordinates = getLatLngObj(TLE, Date.now()+(i * granularity * 1000))


        drawPointByCoordinates(
            coordinates["lat"], coordinates["lng"], 7, true
        )
    }
    previous_longitude = NaN

    
}
function updateTitle() {
    const title = document.getElementById('title')

    title.textContent = "Currently tracking: " + TLE.split('\n')[0]
}

function updateCounters(tle) {
    var info = getSatelliteInfo(tle)

    lat_update.textContent = info["lat"].toFixed(3);
    lng_update.textContent = info["lng"].toFixed(3);
    vel_update.textContent = info["velocity"].toFixed(3) + " km/s"
    hgt_update.textContent = info["height"].toFixed(3) + " km"
} 

function updateGroundCenter() {
drawCirclePointByPoint(ctx, parseFloat(gs_lat.value), parseFloat(gs_lon.value), parseFloat(gs_ran.value), canvas.width, canvas.height);
}
function drawCirclePointByPoint(ctx, centerLat, centerLon, radiusKm, mapWidth, mapHeight) {
    const EARTH_RADIUS = 6371;

    // Convert degrees to radians
    function toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Convert lat/lon to canvas coordinates
    function clampLatitude(lat) {
        return Math.max(-90, Math.min(90, lat));
    }

    // Convert lat/lon to canvas coordinates
    function getCanvasCoordinates(lat, lon) {
        const clampedLat = clampLatitude(lat);
        const x = (lon + 180) * (mapWidth / 360);
        const y = (90 - clampedLat) * (mapHeight / 180);
        return { x, y };
    }

    // Haversine formula to calculate point on great circle
    function destinationPoint(lat, lon, bearing, distance) {
        const δ = distance / EARTH_RADIUS;
        const φ1 = toRadians(lat);
        const λ1 = toRadians(lon);
        const θ = toRadians(bearing);

        const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + 
                   Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
        const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), 
                   Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

        return {
            lat: clampLatitude(φ2 * 180 / Math.PI),
            lon: λ2 * 180 / Math.PI
        };
    }

    // Draw circle point by point
    ctx.beginPath();
    ctx.strokeStyle = 'red';

    
    const pointCount = 360; // Number of points to draw the circle
    for (let i = 0; i < pointCount; i++) {
        const bearing = i * (360 / pointCount);
        const point = destinationPoint(centerLat, centerLon, bearing, radiusKm);
        var canvasPoint = getCanvasCoordinates(point.lat, point.lon);
        
        if (canvasPoint.y < 2 && max_latitude == 91) {
            max_latitude = centerLat;
            ctx.lineTo(canvasPoint.x, 0)
            console.log("Setting maximum latitude")
        }

        if (max_latitude != 91 && (i == 0 || i == pointCount)) {
            canvasPoint.y = 0

        }

        if (i === 0) {
            ctx.moveTo(canvasPoint.x, canvasPoint.y);
        } else {
            ctx.lineTo(canvasPoint.x, canvasPoint.y);
        }

        
    }
    max_latitude = 91;

    
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
    ctx.fill();
}

// Example usage:
    

function transformCoordinatesToPixels(latitude, longitude) {
    var mapWidth    = canvas.width; 
    var mapHeight   = canvas.height;

    // get x value
    // var x = (longitude+180)*(mapWidth/360)

    // // convert from degrees to radians
    // var latRad = (latitude)*Math.PI/180;

    // // get y value
    // var mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    // var y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));
    var x = ((longitude + 180) * (mapWidth  / 360));
    var y = (((latitude * -1) + 90) * (mapHeight/ 180));
  
    
    return {"x": x, "y": y}
}


function moveIcon(latitude, longitude) {
    // The following code assures the correct position of the satellite icon, as well
    //  as the correct position of the canvas, which is used for drawing the lines ahead and behind.
    

    const dimensions = transformCoordinatesToPixels(latitude, longitude)

    // Get coordinates relative to the viewport
    const rect = image.getBoundingClientRect();
    canvas.style.setProperty("top", rect.top+"px")
    canvas.style.setProperty("left", rect.left+"px")

    icon.style.transform = `translate(${dimensions['x']-10}px, ${dimensions['y']-10}px)`;    
}

function drawPointByCoordinates(latitude, longitude, size=6, is_backwards=false) {
    const dimensions = transformCoordinatesToPixels(latitude, longitude)

    // The following logic avoids drawing a line between furthermost right and left points,
    //  when the line would cross over the side.
    if (Math.abs(previous_longitude-dimensions["x"]) > 180) {
        previous_longitude = NaN
        return
    }

    // console.log(dimensions["x"], previous_longitude)

    if (previous_longitude) {
    // if (previous_longitude) {
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
// window.onresize = update;
// window.onscroll = update;

gs_lat.oninput = update;
gs_lon.oninput = update;
gs_ran.oninput = update;

minutes.oninput = updateMinutes

function update() {
   displayTLE(false)
}
function updateMinutes() {
    lines_ahead = minutes.value/2 > 10 ? minutes.value/2 : 10
}

button.addEventListener("click", (event) => {
    try {
        console.log(input.value)
        getSatelliteInfo(input.value)
        
        TLE = input.value;

    } catch {
        input.value = "Incorrect TLE definition."
    }
    displayTLE()
    updateTitle()
  });

  updateTitle()
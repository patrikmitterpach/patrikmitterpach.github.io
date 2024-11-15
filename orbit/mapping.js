const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

GLOBAL_Y_OFFSET = 0
GLOBAL_X_OFFSET = 0

image.onload = () => {
    canvas.width = image.width;
    canvas.height = image.height;

    // Bratislava
    drawPointByCoordinates(48.0991776, 16.9519043)

    // Buenos Aires
    drawPointByCoordinates( -34.6483135,-58.579101)

    // Guinean Gulf
    drawPointByCoordinates(0, 0)



};

function drawPointByCoordinates(latitude, longitude) {
    // latitude    = 41.145556; // (φ)
    // longitude   = -73.995;   // (λ)

    mapWidth    = canvas.width; 
    mapHeight   = canvas.height;

    // get x value
    x = (longitude+180)*(mapWidth/360)

    // convert from degrees to radians
    latRad = latitude*Math.PI/180;

    // get y value
    mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));
        
    ctx.fillStyle = '#ae5d40';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2); // A small circle as a point
    ctx.fill();
}

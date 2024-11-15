const image = document.getElementById('image');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

LATITUDE_OFFSET = 2.2
LONGITUDE_OFFSET = -8.5

image.onload = () => {
    canvas.width = image.width;
    canvas.height = image.height;

    // Bratislava
    drawPointByCoordinates(48.0991776, 16.9519043, 4)

    // Buenos Aires
    drawPointByCoordinates( -34.6483135,-58.579101, 4)

    // Guinean Gulf
    drawPointByCoordinates(0, 0, 4)

    // for (i = -180; i < 190; i+=2) {
    //     for (j = -90; j < 90; j+=5) {
    //         drawPointByCoordinates(j, i, 2 )
    //         if (j == 0) {
    //             drawPointByCoordinates(j, i, 4 )
    //         }
    //     }
    // }



};

function drawPointByCoordinates(latitude, longitude, size=6) {
    // latitude    = 41.145556; // (φ)
    // longitude   = -73.995;   // (λ)

    mapWidth    = canvas.width; 
    mapHeight   = canvas.height;

    // get x value
    x = (longitude+180+LONGITUDE_OFFSET)*(mapWidth/360)

    // convert from degrees to radians
    latRad = (latitude+LATITUDE_OFFSET)*Math.PI/180;

    // get y value
    mercN = Math.log(Math.tan((Math.PI/4)+(latRad/2)));
    y     = ((mapHeight)/2)-(mapWidth*mercN/(2*Math.PI));
        
    ctx.fillStyle = '#ae5d40';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2); // A small circle as a point
    ctx.fill();
}

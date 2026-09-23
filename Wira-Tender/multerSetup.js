const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage(
    {
        destination: (request, file, callback) => 
            {
                callback(null, path.join(__dirname, "assets"));
            }
        ,
        filename: (request, file, callback) => 
            {
                callback(null, `${Date.now()}-${file.originalname}`);
            }
        ,
    }
);

module.exports = multer({ storage });
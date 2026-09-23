const multer = require("multer");
const path = require("path");

const wiraStorage = multer.diskStorage(
{
    destination: (request, file, callback) =>
    {
        callback(null, path.join(__dirname, "..", "assets"));
    },

    filename: (request, file, callback) =>
    {
        const filename = file.originalname.replace(/%20/g, " ");
        callback(null, `${Date.now()}-${filename}`);
    }
});

const wiraUpload = multer({ storage: wiraStorage });
module.exports = wiraUpload

const WiraManager = require("./WiraManager/WiraManager");

let Wira = null;

function socketIOHandler(io)
{
    Wira = new WiraManager(io);

    io.use(async (socket, next) =>
    {
        const result = await Wira.authenticate("user", socket, null);

        if(!result.success)
        {
            const err = new Error(JSON.stringify({
                statusCode: result.statusCode,
                success: false,
                message: result.message,
                data: result.data ?? null
            }));

            return next(err);
        }

        next();
    });

    io.on("connection", (socket) =>
    {
        console.log("Socket Connected: ", socket.user);

        socket.on("window", async (body, callback) =>
        {
            await Wira.window(socket, null, body, callback);
        });

        socket.on("scroll", async (body, callback) =>
        {
            await Wira.scroll(socket, null, body, callback);
        });

        socket.on("message", async (body, callback) =>
        {
            await Wira.message(socket, null, body, callback);
        });

        socket.on("abort", async (body, callback) =>
        {
            await Wira.abort(socket, null, body, callback);
        });

        socket.on("wishlist", async (body, callback) => 
        {
            await Wira.wishlist(socket, body, callback);
        });

        socket.on("applyJob", async (body, callback) => 
        {
            await Wira.applyJob(socket, body, callback);
        });

        socket.on("disconnect", async () =>
        {
            await Wira.disconnect(socket, null);
        });
    });
}

function getWira()
{
    return Wira;
}

module.exports = {
    socketIOHandler,
    getWira
};
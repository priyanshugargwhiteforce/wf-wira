const express = require("express");
const router = express.Router();
const tenderMigrator = require("../utility/tenderMigration");

router.post("/tender-pool-migration", async (request, response) => {

    try
    {
        tenderMigrator.triggerTenderMigration().catch((err) =>
        {
            console.error("❌ Tender migration failed:", err);
        });

        return response.status(202).json(
        {
            success : true,
            message : "Tender migration started"
        });
    }
    catch(err)
    {
        console.error("❌ Error triggering tender migration:", err);

        return response.status(500).json(
        {
            success : false,
            error : err.message
        });
    }

});

module.exports = router;
const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "..", "assets", "official_resume_assets");

function localDataUri(filename)
{
    try
    {
        const filePath = path.join(ASSETS_DIR, filename);
        const ext      = path.extname(filename).toLowerCase();

        const mimeMap = {
            ".png":  "image/png",
            ".jpg":  "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg":  "image/svg+xml",
            ".webp": "image/webp",
        };

        const mime = mimeMap[ext] ?? "image/png";
        const data = fs.readFileSync(filePath).toString("base64");
        return `data:${mime};base64,${data}`;
    }
    catch(err)
    {
        console.warn(`⚠️  Could not load asset [${filename}]: ${err.message}`);
        return "";
    }
}

function tableRow(label, value, isFirst = false)
{
    if(value === null || value === undefined || value === '')
    {
        return '';
    }

    return /* html */ `
    <tr>
        <td style="font-family:Poppins,sans-serif; border:0.6px solid #ddd; padding:11px 0; font-size:0.9rem; line-height:24px; text-align:center; ${isFirst ? '' : 'border-top:none;'} width:50%;">
            <strong style="font-weight:600;">${label}</strong>
        </td>
        <td style="font-family:Poppins,sans-serif; border:0.6px solid #ddd; padding:11px 0; font-size:0.9rem; line-height:24px; text-align:center; ${isFirst ? '' : 'border-top:none;'} width:50%;">
            ${value}
        </td>
    </tr>`;
}

function buildSummaryHTML(data)
{
    const logoUrl      = localDataUri("whiteforce WhiteLogo.png");
    const bgOverlayUrl = localDataUri("12.png");
    const languages    = (data.languages ?? []).filter(Boolean);

    const personalRows = [
        tableRow("Age",              data.age,                                            true),
        tableRow("Current Location", data.location,                                       false),
        tableRow("Gender",           data.gender,                                         false),
        tableRow("Language",         languages.length > 0 ? languages.join(', ') : null, false),
    ].filter(Boolean);

    const workRows = [
        tableRow("Current Company",           data.currentCompany           || null, true),
        tableRow("Position",                  data.currentPosition          || null, false),
        tableRow("Current Salary",            data.currentSalary            || null, false),
        tableRow("Expected Salary",           data.expectedSalary           || null, false),
        tableRow("Total Experience",          data.totalExperience          || null, false),
        tableRow("Total Relevant Experience", data.totalReleventExperience  || null, false),  // ← new
        tableRow("Notice Period",             data.noticePeriod             || null, false),
        tableRow("Background Report",         data.backgroundReport         || null, false),  // ← new
    ].filter(Boolean);

    const educationRows = [
        tableRow("Degree",         data.degree       || null, true),
        tableRow("Year of Degree", data.yearOfDegree || null, false),
    ].filter(Boolean);

    function fixFirstRow(rows)
    {
        if(rows.length === 0)
        {
            return rows;
        }

        return rows.map((row, i) =>
        {
            if(i === 0)
            {
                return row.replace('border-top:none;', '').replace('border-top:none;', '');
            }

            return row;
        });
    }

    const fixedPersonalRows  = fixFirstRow(personalRows);
    const fixedWorkRows      = fixFirstRow(workRows);
    const fixedEducationRows = fixFirstRow(educationRows);

    return /* html */ `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Resume Summary</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
@page { size: A4; margin: 0; }
body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
.a4-page { width: 210mm; height: 297mm; margin: 0 auto; box-sizing: border-box; overflow: hidden; }
h1, h2, h3 { font-family: 'Montserrat', sans-serif; }
p, td, strong { font-family: 'Poppins', sans-serif; }
</style>
</head>
<body>
<div class="a4-page" style="background: linear-gradient(100deg, #445076, #719786); padding: 0px 0mm;">

    <div style="width: 300px; margin: 3px auto; border: 1px solid #b9d4c429; padding: 1.5px 17.5px; z-index: 5; position: relative; margin-top: 13px;">
        <img style="width: 100%;" src="${logoUrl}" alt="Logo">
    </div>

    <div style="width:100%; position:absolute; top:0; left:0; z-index:0; opacity:0.07; display:none;">
        <img style="width:100%;" src="${bgOverlayUrl}" alt="">
    </div>

    <div style="width: 75%; margin: 27.5px auto; background: white; padding: 31px 38.5px; padding-top: 11px; border-radius: 15px; box-shadow: 6px 6px 20px #26292d8f; position: relative;">

        <div style="width: 90%; vertical-align: top; margin: 17.5px auto;">
            <h1 style="margin: 0; font-size: 1.95rem; text-align: center; color: #5b6c75; margin-bottom: 5px; font-family: Montserrat, sans-serif;">
                ${data.name ?? ''}
            </h1>
            ${data.designation ? `
            <p style="font-family: Poppins, sans-serif; margin: 2px 0; font-weight: 600; font-size: 1.1rem; text-align: center;">
                ${data.designation}
            </p>` : ''}
        </div>

        ${fixedPersonalRows.length > 0 ? `
        <div style="font-family: Poppins, sans-serif; width: 100%; padding: 9px 18.5px; background: linear-gradient(45deg, #485678, #688983); text-align: left;">
            <p style="margin: 1px 0; font-family: Montserrat, sans-serif; font-size: 0.95rem; color: #ffffff;">
                <strong style="font-weight: 600;">Personal Information</strong>
            </p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            ${fixedPersonalRows.join('')}
        </table>` : ''}

        ${fixedWorkRows.length > 0 ? `
        <div style="font-family:Poppins,sans-serif; width:100%; padding:9px 18.5px; background:linear-gradient(45deg,#485678,#688983); text-align:left;">
            <p style="margin:1px 0; font-family:Montserrat,sans-serif; font-size:0.95rem; color:#ffffff;">
                <strong style="font-weight:600;">Work Experience</strong>
            </p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            ${fixedWorkRows.join('')}
        </table>` : ''}

        ${fixedEducationRows.length > 0 ? `
        <div style="font-family:Poppins,sans-serif; width:100%; padding:9px 18.5px; background:linear-gradient(45deg,#485678,#688983); text-align:left;">
            <p style="margin:1px 0; font-family:Montserrat,sans-serif; font-size:0.95rem; color:#ffffff;">
                <strong style="font-weight:600;">Education</strong>
            </p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            ${fixedEducationRows.join('')}
        </table>` : ''}

        <div style="padding-top:17px; border-top:2px solid #799285; text-align:center; font-size:13px; margin-top:17.5px; font-weight:500; color:#1a1b1f; font-family:Poppins,sans-serif;">
            <p style="font-size:15px; margin-top:0; font-weight:600; color:#3e4950; font-family:Montserrat,sans-serif;">Powered by Happiest Resume</p>
            <p>© 2026 White Force - Premium Brand of Happy Square Outsourcing Services Limited</p>
        </div>

    </div>
</div>
</body>
</html>`;
}

module.exports = { buildSummaryHTML };
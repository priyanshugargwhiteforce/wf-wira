const fs   = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "..", "assets", "official_resume_assets");

// ── Constants ─────────────────────────────────────────────────────────────────
const MM       = 3.7795;
const FOOTER_H_MM = 12; // footer image height in mm — adjust if image changes

// ── localDataUri ──────────────────────────────────────────────────────────────
function localDataUri(filename) {
    try {
        const filePath = path.join(ASSETS_DIR, filename);
        const ext      = path.extname(filename).toLowerCase();
        const mimeMap  = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };
        const mime     = mimeMap[ext] ?? "image/png";
        const data     = fs.readFileSync(filePath).toString("base64");
        return `data:${mime};base64,${data}`;
    } catch(err) {
        console.warn(`⚠️  Could not load asset [${filename}]: ${err.message}`);
        return "";
    }
}

function buildResumeFooterHTML() {
    const footerImageUrl = localDataUri("footerr.jpg");
    return `<div style="position: relative; bottom: 0; left:0; width:100%; height:auto; margin:0; padding:0; z-index:10;">
        <img src="${footerImageUrl}" style="width:100%; height:auto; display:block;" alt="Footer"/>
    </div>`;
}

// ── Section heading ───────────────────────────────────────────────────────────
function sectionHeading(title) {
    return `<h2 style="margin-top:25px; font-size:15px; border-bottom:1px solid #ccc; padding-bottom:9px; margin-bottom:12px; color:#34454e; font-family:Montserrat,sans-serif;">${title}</h2>`;
}

/*function footerFunction(bottom = "0", footerImageUrl)
{
    footerImageUrl  = localDataUri("footerr.jpg");
    return `
        <div style="position: fixed; bottom: ${bottom}; left: 0; width: 100%; z-index: 10;">
            <img src="${footerImageUrl}" style="width:100%; height:auto; display:block;" alt="Footer"/>
        </div>
    `;
}*/

// ── Main ──────────────────────────────────────────────────────────────────────
function buildResumeHTML(data, allowCredentials = false) {
    console.log(data);
    const jobs            = (data.jobs           ?? []).filter(j => j && (j.company  || j.position));
    const projects        = (data.projects       ?? []).filter(p => p && p.title);
    const educationList   = (data.educationList  ?? []).filter(e => e && (e.degree   || e.institution));
    const certifications  = (data.certifications ?? []).filter(c => c && (c.name     || c.title));
    const achievements    = (data.achievements   ?? []).filter(a => a && (a.title    || typeof a === "string"));
    const languages       = (data.languages      ?? []).filter(l => l && (l.name     || typeof l === "string"));
    const skillsTechnical = (data.skills?.technical ?? data.skills ?? []).filter(Boolean);
    const skillsSoft      = (data.skills?.soft       ?? []).filter(Boolean);

    const personalFields = [
        { label: "Date of Birth",      value: data.dob           ?? null },
        { label: "Age",                value: data.age           ?? null },
        { label: "Gender",             value: data.gender        ?? null },
        { label: "Marital Status",     value: data.maritalStatus ?? null },
        { label: "Preferred Location", value: data.prefLocation  ?? null },
        { label: "Notice Period",      value: data.noticePeriod  ?? null },
    ].filter(f => f.value);

    const hasContact = allowCredentials && (data.email || data.phone);

    // ── Build content HTML ────────────────────────────────────────────────────
    let content = "";

    // Header
    content += `
    <div style="width:70%; margin:0 auto; background:#7d9e9e24; padding-bottom:15px;">
        <div style="background:linear-gradient(100deg,#445076,#719786); height:22px; width:374px; margin:0 auto; margin-bottom:22px;"></div>
        <h1 style="margin:0; text-align:center; font-size:36px; color:#222222; letter-spacing:1px; margin-bottom:9px;">${data.name ?? ''}</h1>
        ${data.designation ? `<p style="margin:5px 0 15px 0; text-align:center; font-size:18px; color:#373b44; margin-top:14px;">${data.designation}</p>` : ''}
    </div>
    ${hasContact ? `
    <div style="font-family:Poppins,sans-serif; width:92%; text-align:center; margin:25px auto 2.5px;">
        ${data.email ? `<p style="margin:2px 0; width:50%; display:inline-block; text-align:left; font-size:0.85rem;"><strong style="font-weight:600;">Email:</strong> ${data.email}</p>` : ''}
        ${data.phone ? `<p style="margin:2px 0; width:49%; display:inline-block; text-align:right; font-size:0.85rem;"><strong style="font-weight:600;">Phone:</strong> ${data.phone}</p>` : ''}
    </div>` : ''}
    ${(data.location || data.totalExperience) ? `
    <div style="font-family:Poppins,sans-serif; width:92%; text-align:center; margin:2.5px auto 25px;">
        ${data.location        ? `<p style="margin:2px 0; width:50%; display:inline-block; text-align:left; font-size:0.85rem;"><strong style="font-weight:600;">Location:</strong> ${data.location}</p>` : ''}
        ${data.totalExperience ? `<p style="margin:2px 0; width:49%; display:inline-block; text-align:right; font-size:0.85rem;"><strong style="font-weight:600;">Total Exp:</strong> ${data.totalExperience}</p>` : ''}
    </div>` : ''}`;

    function sec(html) {
        content += `<div style="width:92%; margin:0 auto;">${html}</div>`;
    }

    // Summary
    if (data.summary) {
        sec(sectionHeading('Professional Summary'));
        sec(`<p style="font-size:0.85rem; line-height:22px; color:#27262c; text-align:justify; font-family:Poppins,sans-serif; margin-top:0;">${data.summary}</p>`);
    }

    // Skills
    if (skillsTechnical.length > 0 || skillsSoft.length > 0) {
        sec(sectionHeading('Skills'));
        if (skillsTechnical.length > 0) {
            sec(`<div>
                <p style="margin:6px 0 4px 0; font-size:0.8rem; font-weight:600; color:#445076; font-family:Poppins,sans-serif;">Technical Skills</p>
                <p style="margin:0 0 10px 0; font-size:0.82rem; line-height:26px; font-family:Poppins,sans-serif; color:#27262c;">
                    ${skillsTechnical.map(s => `<span style="display:inline-block; background:#e8edf5; border:1px solid #c5cfe0; border-radius:4px; padding:2px 10px; margin:2px 4px 2px 0; font-size:0.8rem;">${s}</span>`).join('')}
                </p>
            </div>`);
        }
        if (skillsSoft.length > 0) {
            sec(`<div>
                <p style="margin:6px 0 4px 0; font-size:0.8rem; font-weight:600; color:#445076; font-family:Poppins,sans-serif;">Soft Skills</p>
                <p style="margin:0; font-size:0.82rem; line-height:26px; font-family:Poppins,sans-serif; color:#27262c;">
                    ${skillsSoft.map(s => `<span style="display:inline-block; background:#e8f5ee; border:1px solid #b5d6c5; border-radius:4px; padding:2px 10px; margin:2px 4px 2px 0; font-size:0.8rem;">${s}</span>`).join('')}
                </p>
            </div>`);
        }
    }

    // Jobs
    if (jobs.length > 0) {
        sec(sectionHeading('Career Experience'));
        jobs.forEach(job => {
            sec(`<div>
                <p style="margin:10px 0 0 0; font-weight:600; font-size:0.85rem; font-family:Poppins,sans-serif;">${[job.company, job.position].filter(Boolean).join(' – ')}</p>
                ${(job.period || job.location) ? `<p style="margin:0 0 4px 0; font-size:13px; color:#666; margin-top:4px; font-family:Poppins,sans-serif;">${[job.period, job.location].filter(Boolean).join(' | ')}</p>` : ''}
                ${job.description ? `<p style="font-size:14px; line-height:22px; text-align:justify; font-family:Poppins,sans-serif;">${job.description}</p>` : ''}
            </div>`);
        });
    }

    // Projects
    if (projects.length > 0) {
        sec(sectionHeading('Key Projects'));
        projects.forEach((proj, idx) => {
            const isLast = idx === projects.length - 1;
            sec(`<div style="margin-bottom:${isLast ? '12px' : '20px'};">
                <p style="margin:10px 0 0 0; font-weight:600; font-size:0.85rem; font-family:Poppins,sans-serif;">${proj.title}</p>
                ${(proj.period || proj.technologies) ? `<p style="margin:0 0 4px 0; font-size:13px; color:#666; margin-top:4px; font-family:Poppins,sans-serif;">${[proj.period, proj.technologies ? `Technologies: ${proj.technologies}` : null].filter(Boolean).join(' | ')}</p>` : ''}
                ${proj.description ? `<p style="font-size:14px; line-height:22px; text-align:justify; font-family:Poppins,sans-serif; margin-bottom:5px;">${proj.description}</p>` : ''}
                ${proj.url ? `<p style="margin:0 0 4px 0; font-size:13px; color:#666; margin-top:4px; font-family:Poppins,sans-serif;">${proj.url}</p>` : ''}
            </div>`);
        });
    }

    // Certifications
    if (certifications.length > 0) {
        sec(sectionHeading('Certifications'));
        certifications.forEach(c => {
            sec(`<p style="margin:8px 0; font-size:0.85rem; font-family:Poppins,sans-serif;">
                <strong style="font-weight:600;">${c.name ?? c.title ?? ''}</strong>
                ${c.issuer ? ` – ${c.issuer}` : ''}
                ${c.year   ? `<span style="color:#666; font-size:13px;"> (${c.year})</span>` : ''}
            </p>`);
        });
    }

    // Achievements
    if (achievements.length > 0) {
        sec(sectionHeading('Achievements &amp; Awards'));
        achievements.forEach(a => {
            const text   = typeof a === "string" ? a : (a.title ?? '');
            const detail = typeof a === "object"  ? (a.detail ?? a.description ?? '') : '';
            sec(`<p style="margin:8px 0 2px 0; font-size:0.85rem; font-family:Poppins,sans-serif;">
                <strong style="font-weight:600;">✦ ${text}</strong>${detail ? ` – ${detail}` : ''}
            </p>`);
        });
    }

    // Education
    if (educationList.length > 0) {
        sec(sectionHeading('Education'));
        educationList.forEach(edu => {
            sec(`<p style="margin:8px 0; font-size:0.85rem; font-family:Poppins,sans-serif;">
                ${edu.degree ? `<strong style="font-weight:600;">${edu.degree}</strong>` : ''}
                ${edu.degree && edu.institution ? ' – ' : ''}
                ${edu.institution ?? ''}
                ${edu.years ? ` (${edu.years})` : ''}
            </p>`);
        });
    }

    // Languages
    if (languages.length > 0) {
        sec(sectionHeading('Languages'));
        const langLine = languages.map(l => {
            const name = typeof l === "string" ? l : (l.name ?? '');
            const prof = typeof l === "object"  ? (l.proficiency ?? '') : '';
            return prof
                ? `<strong style="font-weight:600;">${name}</strong> <span style="color:#666;">(${prof})</span>`
                : `<strong style="font-weight:600;">${name}</strong>`;
        }).join(' &nbsp;|&nbsp; ');
        sec(`<p style="margin:0; font-size:0.85rem; font-family:Poppins,sans-serif; line-height:24px; color:#27262c;">${langLine}</p>`);
    }

    // Personal Information
    if (personalFields.length > 0) {
        sec(sectionHeading('Personal Information'));
        personalFields.forEach(field => {
            sec(`<div style="display:flex; justify-content:space-between; border-bottom:1px solid #f0f0f0; padding:6px 0;">
                <p style="margin:0; font-size:0.82rem; font-weight:600; color:#445076; font-family:Poppins,sans-serif; width:45%;">${field.label}</p>
                <p style="margin:0; font-size:0.82rem; color:#27262c; font-family:Poppins,sans-serif; width:55%; text-align:right;">${field.value}</p>
            </div>`);
        });
    }

    // Declaration
    if (data.declaration) {
        sec(sectionHeading('Declaration'));
        sec(`<p style="line-height:22px; text-align:justify; font-size:0.85rem; font-family:Poppins,sans-serif;">${data.declaration}</p>`);
    }

    return /* html */`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Resume</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
@page { size: A4; margin: 12mm 0mm 15mm 0mm; }
@page :first { size: A4; margin: 0mm 0mm 15mm 0mm; }
h1,h2,h3    { font-family: 'Montserrat', sans-serif; }
h2 { margin-top: 40px; }
p,td,strong { font-family: 'Poppins', sans-serif; }
body { margin: 0; padding: 0; }
@media print { body { width: 100%; padding: 0; margin: 0; } }
</style>
</head>
<body>
${content}
</body>
</html>`;
}

module.exports = { buildResumeHTML, buildResumeFooterHTML };
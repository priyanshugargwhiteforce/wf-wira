function template1(data) 
{
    const {
      title,
      summary,
      responsibilities = [],
      required_skills = [],
      experience,
      location,
      employment_type
    } = data;
  
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8" />
  <title>${title} – Job Description</title>
  
  <style>
    @page {
      size: A4;
      margin: 0;
    }
  
    html, body {
      width: 210mm;
      height: 297mm;
      margin: 0;
      padding: 0;
      background: #e5e7eb;
      font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
  
    .page {
      width: 210mm;
      height: 297mm;
      padding: 18mm;
      background: #ffffff;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
  
    .header {
      padding-bottom: 8mm;
      border-bottom: 2px solid #e5e7eb;
    }
  
    .header h1 {
      font-size: 28px;
      margin: 0 0 4mm 0;
      color: #111827;
    }
  
    .meta {
      font-size: 13px;
      color: #374151;
    }
  
    .meta span {
      margin-right: 18px;
    }
  
    .summary {
      padding: 8mm 0;
    }
  
    .summary h2 {
      font-size: 17px;
      margin: 0 0 3mm 0;
      color: #111827;
    }
  
    .summary p {
      font-size: 14px;
      line-height: 1.6;
      margin: 0;
      text-align: justify;
    }
  
    .content {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10mm;
      padding-top: 6mm;
    }
  
    .box h3 {
      font-size: 16px;
      margin: 0 0 4mm 0;
      padding-bottom: 2mm;
      border-bottom: 2px solid #e5e7eb;
      color: #111827;
    }
  
    ul {
      margin: 0;
      padding-left: 16px;
    }
  
    li {
      font-size: 14px;
      margin-bottom: 6px;
      line-height: 1.4;
    }
  
    .footer {
      padding-top: 6mm;
      border-top: 2px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
  </style>
  </head>
  
  <body>
    <div class="page">
  
      <div class="header">
        <h1>${title}</h1>
        <div class="meta">
          <span><strong>Location:</strong> ${location}</span>
          <span><strong>Employment Type:</strong> ${employment_type}</span>
          <span><strong>Experience:</strong> ${experience}</span>
        </div>
      </div>
  
      <div class="summary">
        <h2>Job Summary</h2>
        <p>${summary}</p>
      </div>
  
      <div class="content">
        <div class="box">
          <h3>Key Responsibilities</h3>
          <ul>
            ${responsibilities.map(item => `<li>${item}</li>`).join("")}
          </ul>
        </div>
  
        <div class="box">
          <h3>Required Skills & Qualifications</h3>
          <ul>
            ${required_skills.map(skill => `<li>${skill}</li>`).join("")}
          </ul>
        </div>
      </div>
  
      <div class="footer">
        This job description is intended for hiring and internal evaluation purposes only.
      </div>
  
    </div>
  </body>
  </html>`;
}

module.exports = {
  template1
}
  
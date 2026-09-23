function template1(resumeData, credentials = true) 
{
    const d = resumeData.data;
    const initials = d.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  
    const contactHTML = `
  ${credentials ? `
    <div class="contact-row">
      <div class="contact-cell">
        <div class="contact-item">
          <span class="contact-label">Email:</span>
          <span>${d.email}</span>
        </div>
      </div>
      <div class="contact-cell">
        <div class="contact-item">
          <span class="contact-label">Phone:</span>
          <span>${d.contact}</span>
        </div>
      </div>
    </div>
  ` : ''}

  <div class="contact-row">
    <div class="contact-cell">
      <div class="contact-item">
        <span class="contact-label">City:</span>
        <span>${d.city}, ${d.state}</span>
      </div>
    </div>
    <div class="contact-cell">
      <div class="contact-item">
        <span class="contact-label">Address:</span>
        <span>${d.address.split(',').slice(0, 2).join(',')}</span>
      </div>
    </div>
  </div>
`;

  
  const personalInfoHTML = `
    <div class="info-row">
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Gender:</span>
          <span>${d.gender}</span>
        </div>
      </div>
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Marital Status:</span>
          <span>${d.marital_status}</span>
        </div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Willing to Relocate:</span>
          <span>${d.relocate}</span>
        </div>
      </div>
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Notice Period:</span>
          <span>${d.notice_period}</span>
        </div>
      </div>
    </div>
    <div class="info-row">
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Communication:</span>
          <span>${d.communication}</span>
        </div>
      </div>
      <div class="info-cell">
        <div class="info-item">
          <span class="info-label">Preferred Location:</span>
          <span>${d.preferred_location}</span>
        </div>
      </div>
    </div>
  `;
  
  const languagesHTML = d.language
    .map(lang => `<span class="language-badge">${lang}</span>`)
    .join(' ');
  
  const experienceHTML = d.experience_data
    .map(exp => `
      <div class="experience-item clearfix">
        <div class="experience-header">
          <span class="experience-title">${exp.designation}</span>
          <span class="experience-duration">${exp.duration}</span>
        </div>
        <div class="experience-company">${exp.company_name}</div>
      </div>
    `)
    .join('');
  
  const educationHTML = d.education_data
    .map(edu => `
      <div class="education-item clearfix">
        <div class="education-header">
          <span class="education-degree">${edu.education_type}</span>
          <span class="education-year">${edu.education_year || 'Present'}</span>
        </div>
        <div class="education-institute">${edu.university}</div>
      </div>
    `)
    .join('');
  
  const skillsHTML = d.skills
    .map(skill => `<li>${skill}</li>`)
    .join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Professional Resume - ${d.fullName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Arial', 'Helvetica', sans-serif;
            background: white;
            color: #333;
            line-height: 1.5;
        }

        .resume-container {
            width: 210mm;
            height: 297mm;
            margin: 0 auto;
            background: white;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Header Section */
        .header {
            padding: 25px 35px;
            border-bottom: 3px solid #2c3e50;
            flex-shrink: 0;
        }

        .header-content {
            display: table;
            width: 100%;
        }

        .profile-section {
            display: table-cell;
            vertical-align: middle;
            width: 100px;
            padding-right: 20px;
        }

        .profile-image {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #2c3e50;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 30px;
            font-weight: bold;
        }

        .header-info {
            display: table-cell;
            vertical-align: middle;
        }

        .name {
            font-size: 28px;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: -4px;
            margin-top: 4px;
        }

        .title {
            font-size: 16px;
            color: #7f8c8d;
            font-weight: normal;
        }

        /* Main Content */
        .content {
            padding: 20px 35px;
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .section {
            margin-bottom: 16px;
        }

        .section-header {
            display: table;
            width: 100%;
            margin-bottom: 10px;
            border-bottom: 2px solid #ecf0f1;
            padding-bottom: 5px;
        }

        .section-icon {
            display: table-cell;
            width: 32px;
            vertical-align: middle;
        }

        .icon-circle {
            width: 28px;
            height: 28px;
            background: #2c3e50;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 14px;
        }

        .section-title-cell {
            display: table-cell;
            vertical-align: middle;
            padding-left: 10px;
        }

        .section-title {
            font-size: 14px;
            font-weight: bold;
            color: #2c3e50;
            text-transform: uppercase;
            letter-spacing: 0.8px;
        }

        .section-content {
            padding-left: 42px;
        }

        /* Contact Grid */
        .contact-grid {
            display: table;
            width: 100%;
            border-collapse: collapse;
        }

        .contact-row {
            display: table-row;
        }

        .contact-cell {
            display: table-cell;
            padding: 4px 15px 4px 0;
            width: 50%;
            vertical-align: top;
        }

        .contact-item {
            font-size: 12px;
            color: #555;
            word-wrap: break-word;
        }

        .contact-label {
            font-weight: bold;
            color: #2c3e50;
            display: inline-block;
            min-width: 55px;
        }

        /* Personal Info Grid */
        .info-grid {
            display: table;
            width: 100%;
            border-collapse: collapse;
        }

        .info-row {
            display: table-row;
        }

        .info-cell {
            display: table-cell;
            padding: 4px 15px 4px 0;
            width: 50%;
            vertical-align: top;
        }

        .info-item {
            font-size: 12px;
            color: #555;
        }

        .info-label {
            font-weight: bold;
            color: #2c3e50;
            display: inline-block;
            min-width: 120px;
        }

        /* Languages */
        .languages-list {
            display: inline;
        }

        .language-badge {
            display: inline-block;
            background: #2c3e50;
            color: white;
            padding: 5px 14px;
            border-radius: 14px;
            font-size: 11px;
            margin-right: 8px;
            margin-bottom: 6px;
        }

        /* Experience Items */
        .experience-item {
            margin-bottom: 12px;
            position: relative;
            padding-left: 18px;
        }

        .experience-item::before {
            content: "●";
            position: absolute;
            left: 0;
            top: 1px;
            color: #2c3e50;
            font-size: 11px;
        }

        .experience-header {
            margin-bottom: 4px;
        }

        .experience-title {
            font-weight: bold;
            color: #2c3e50;
            font-size: 13px;
            display: inline-block;
        }

        .experience-duration {
            color: #555;
            font-size: 12px;
            font-weight: bold;
            float: right;
        }

        .experience-company {
            color: #7f8c8d;
            font-size: 11px;
            margin-top: 2px;
            line-height: 1.4;
        }

        /* Education Items */
        .education-item {
            margin-bottom: 12px;
            position: relative;
            padding-left: 18px;
        }

        .education-item::before {
            content: "●";
            position: absolute;
            left: 0;
            top: 1px;
            color: #2c3e50;
            font-size: 11px;
        }

        .education-header {
            margin-bottom: 4px;
        }

        .education-degree {
            font-weight: bold;
            color: #2c3e50;
            font-size: 13px;
            display: inline-block;
        }

        .education-year {
            color: #555;
            font-size: 12px;
            font-weight: bold;
            float: right;
        }

        .education-institute {
            color: #7f8c8d;
            font-size: 11px;
            margin-top: 2px;
            line-height: 1.4;
        }

        /* Skills List */
        .skills-list {
            columns: 3;
            column-gap: 18px;
            list-style: none;
        }

        .skills-list li {
            color: #333;
            font-size: 12px;
            padding: 3px 0;
            padding-left: 14px;
            position: relative;
            break-inside: avoid;
            page-break-inside: avoid;
        }

        .skills-list li::before {
            content: "•";
            position: absolute;
            left: 0;
            color: #2c3e50;
            font-size: 15px;
            font-weight: bold;
        }

        /* Clearfix */
        .clearfix::after {
            content: "";
            display: table;
            clear: both;
        }

        /* Print Styles */
        @media print {
            body {
                margin: 0;
                padding: 0;
            }

            .resume-container {
                width: 100%;
                height: 100%;
                box-shadow: none;
            }
        }

        @page {
            size: A4;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="resume-container">
        <div class="header">
            <div class="header-content">
                <div class="profile-section">
                    <div class="profile-image">${initials}</div>
                </div>
                <div class="header-info">
                    <h1 class="name">${d.fullName}</h1>
                    <p class="title">${d.industry}</p>
                </div>
            </div>
        </div>

        <div class="content">
            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">📞</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Contact Information</h2>
                    </div>
                </div>
                <div class="section-content">
                    <div class="contact-grid">
                        ${contactHTML}
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">ℹ️</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Personal Information</h2>
                    </div>
                </div>
                <div class="section-content">
                    <div class="info-grid">
                        ${personalInfoHTML}
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">🌐</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Languages</h2>
                    </div>
                </div>
                <div class="section-content">
                    <div class="languages-list">
                        ${languagesHTML}
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">💼</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Professional Experience</h2>
                    </div>
                </div>
                <div class="section-content">
                    ${experienceHTML}
                </div>
            </div>

            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">🎓</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Education</h2>
                    </div>
                </div>
                <div class="section-content">
                    ${educationHTML}
                </div>
            </div>

            <div class="section">
                <div class="section-header">
                    <div class="section-icon">
                        <div class="icon-circle">⚙️</div>
                    </div>
                    <div class="section-title-cell">
                        <h2 class="section-title">Technical Skills</h2>
                    </div>
                </div>
                <div class="section-content">
                    <ul class="skills-list">
                        ${skillsHTML}
                    </ul>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
}

function template2(resumeData, credentials = true) 
{
    const d = resumeData.data;
    
    // Safe data extraction
    const safeGet = (value, fallback = '') => value || fallback;
    const safeArray = (arr) => Array.isArray(arr) ? arr : [];
    
    // Contact Bar HTML
    const contactBarHTML = `
        ${credentials && d.email ? `
            <div class="contact-bar-item">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                <span>${d.email}</span>
            </div>
        ` : ''}
        ${credentials && d.contact ? `
            <div class="contact-bar-item">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                <span>${d.contact}</span>
            </div>
        ` : ''}
        ${d.city && d.state ? `
            <div class="contact-bar-item">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                <span>${d.city}, ${d.state}</span>
            </div>
        ` : ''}
    `;
    
    // Personal Information Grid
    const personalInfoItems = [
        { label: 'Gender', value: d.gender },
        { label: 'Marital Status', value: d.marital_status },
        { label: 'Communication', value: d.communication },
        { label: 'Willing to Relocate', value: d.relocate },
        { label: 'Notice Period', value: d.notice_period ? `${d.notice_period} Days` : null },
        { label: 'Total Experience', value: d.total_experience },
        { label: 'Preferred Location', value: d.preferred_location },
        { label: 'Address', value: d.address ? d.address.split(',').slice(0, 3).join(',').trim() : null },
        { label: 'Date of Birth', value: d.date_of_birth },
        { label: 'Expected Salary', value: d.expected_salary }
    ].filter(item => item.value);
    
    const personalInfoHTML = personalInfoItems.map(item => `
        <div class="info-item">
            <div class="info-label">${item.label}</div>
            <div class="info-value">${item.value}</div>
        </div>
    `).join('');
    
    // Education Section
    const education = safeArray(d.education_data).filter(edu => edu && (edu.education_type || edu.education_name));
    const educationHTML = education.length > 0 ?
        education.map(edu => `
            <div class="experience-item">
                <div class="experience-header">
                    <div>
                        ${edu.education_name || edu.university ? `<div class="experience-institution">${edu.education_name || edu.university}</div>` : ''}
                        <div class="experience-title">${safeGet(edu.education_type, 'Degree')}</div>
                    </div>
                    ${edu.education_year ? `<div class="experience-date">${edu.education_year}</div>` : ''}
                </div>
            </div>
        `).join('') :
        '<p>No education history available</p>';
    
    // Experience Section
    const experiences = safeArray(d.experience_data).filter(exp => exp && exp.designation);
    const experienceHTML = experiences.length > 0 ?
        experiences.map(exp => `
            <div class="experience-item">
                <div class="experience-header">
                    <div>
                        ${exp.company_name ? `<div class="experience-institution">${exp.company_name}</div>` : ''}
                        <div class="experience-title">${safeGet(exp.designation, 'Position')}</div>
                    </div>
                    ${exp.duration ? `<div class="experience-date">${exp.duration}</div>` : 
                      exp.total_experience_month ? `<div class="experience-date">${exp.total_experience_month} months</div>` : ''}
                </div>
            </div>
        `).join('') :
        '<p>No work experience listed</p>';
    
    // Skills Section
    const skills = safeArray(d.skills).filter(Boolean);
    const skillsHTML = skills.length > 0 ?
        skills.map(skill => `<div class="skill-item">${skill}</div>`).join('') :
        '<p>No skills listed</p>';
    
    // Languages Section
    const languages = safeArray(d.language).filter(Boolean);
    const languagesHTML = languages.length > 0 ?
        languages.map(lang => `<div class="language-item">${lang}</div>`).join('') :
        '<p>No languages specified</p>';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resume - ${safeGet(d.fullName, 'Resume')}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f5f5f5;
            color: #333;
        }

        .resume-container {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: white;
            display: flex;
            flex-direction: column;
        }

        /* Header Section */
        .header {
            text-align: center;
            padding: 50px 60px 40px;
            background: white;
        }

        .name {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 8px;
            color: #1a1a1a;
        }

        .title {
            font-size: 14px;
            color: #666;
            margin-bottom: 20px;
        }

        .contact-bar {
            display: flex;
            justify-content: center;
            gap: 25px;
            flex-wrap: wrap;
            font-size: 11px;
            color: #555;
        }

        .contact-bar-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .contact-bar-item svg {
            width: 14px;
            height: 14px;
            fill: none;
            stroke: #666;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        /* Content Section */
        .content {
            padding: 0 60px 60px;
            flex: 1;
        }

        .section {
            margin-bottom: 35px;
        }

        .section:last-child {
            margin-bottom: 0;
        }

        .section-title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 20px;
            padding-bottom: 8px;
            border-bottom: 2px solid #333;
            color: #1a1a1a;
        }

        .section-content {
            font-size: 12px;
            line-height: 1.8;
            color: #444;
        }

        /* Personal Info Grid */
        .info-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px 25px;
        }

        .info-item {
            font-size: 11px;
        }

        .info-label {
            font-weight: 600;
            color: #333;
            margin-bottom: 3px;
        }

        .info-value {
            color: #666;
            word-wrap: break-word;
        }

        /* Experience/Education Items */
        .experience-item {
            margin-bottom: 25px;
        }

        .experience-item:last-child {
            margin-bottom: 0;
        }

        .experience-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 15px;
        }

        .experience-institution {
            font-size: 12px;
            color: #666;
            font-style: italic;
            margin-bottom: 3px;
        }

        .experience-date {
            font-size: 11px;
            color: #666;
            white-space: nowrap;
        }

        .experience-title {
            font-size: 13px;
            font-weight: 700;
            color: #1a1a1a;
        }

        /* Skills Section */
        .skills-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px 15px;
        }

        .skill-item {
            font-size: 11px;
            color: #444;
            position: relative;
            padding-left: 12px;
        }

        .skill-item::before {
            content: '•';
            position: absolute;
            left: 0;
            color: #333;
            font-weight: bold;
        }

        /* Languages */
        .languages-list {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        .language-item {
            font-size: 11px;
            color: #444;
            position: relative;
            padding-left: 12px;
        }

        .language-item::before {
            content: '•';
            position: absolute;
            left: 0;
            color: #333;
            font-weight: bold;
        }

        /* Footer Bar */
        .footer-bar {
            background: #444;
            height: 15px;
            margin-top: auto;
        }

        @media print {
            body {
                background: white;
            }
            .resume-container {
                width: 100%;
            }
        }

        @page {
            size: A4;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="resume-container">
        <!-- Header -->
        <div class="header">
            <h1 class="name">${safeGet(d.fullName, 'No Name')}</h1>
            <p class="title">${safeGet(d.industry, 'Professional')}</p>
            <div class="contact-bar">
                ${contactBarHTML}
            </div>
        </div>

        <!-- Content -->
        <div class="content">
            ${personalInfoItems.length > 0 ? `
                <div class="section">
                    <h2 class="section-title">Personal Information</h2>
                    <div class="info-grid">
                        ${personalInfoHTML}
                    </div>
                </div>
            ` : ''}

            ${education.length > 0 ? `
                <div class="section">
                    <h2 class="section-title">Education</h2>
                    <div class="section-content">
                        ${educationHTML}
                    </div>
                </div>
            ` : ''}

            ${experiences.length > 0 ? `
                <div class="section">
                    <h2 class="section-title">Work Experience</h2>
                    <div class="section-content">
                        ${experienceHTML}
                    </div>
                </div>
            ` : ''}

            ${skills.length > 0 ? `
                <div class="section">
                    <h2 class="section-title">Skills</h2>
                    <div class="skills-grid">
                        ${skillsHTML}
                    </div>
                </div>
            ` : ''}

            ${languages.length > 0 ? `
                <div class="section">
                    <h2 class="section-title">Languages</h2>
                    <div class="languages-list">
                        ${languagesHTML}
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- Footer Bar -->
        <div class="footer-bar"></div>
    </div>
</body>
</html>`;
}

module.exports = { 
    template1,
    template2
};
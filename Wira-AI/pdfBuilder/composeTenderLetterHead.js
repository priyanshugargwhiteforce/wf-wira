function composeTenderLetterHead(data) 
{
    const stamp = {
        bottom: "125px",
        right: "30px",
        url: "https://astro-buddy.in/AI/assets/tenderDocuments/TenderStamp.png"
    } 

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        @page {
            size: A4;
            margin: 0;
            padding: 0;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Times New Roman', Georgia, serif;
            font-size: 16px;
            line-height: 1.7;
            color: #1a1a1a;
            position: relative;
            width: 210mm;
            height: 297mm;
        }

        .page-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        .page-background img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .page-container {
            position: relative;
            width: 210mm;
            height: 297mm;
            padding: 80px 70px 100px 70px;
            z-index: 10;
            display: flex;
            flex-direction: column;
        }

        .content-wrapper {
            flex: 1;
            max-width: 100%;
            margin-top: 60px;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
        }

        #doc-date {
            margin-bottom: 20px;
            text-align: left;
            font-weight: bold;
            font-size: 16px;
            letter-spacing: 0.5px;
            flex-shrink: 0;
        }

        #doc-date p {
            margin: 0;
        }

        #doc-recipient {
            margin-bottom: 20px;
            line-height: 1.9;
            text-align: left;
            flex-shrink: 0;
        }

        #doc-recipient p {
            margin: 0;
            font-size: 15px;
            font-weight: 500;
            letter-spacing: 0.3px;
        }

        #doc-subject {
            margin-bottom: 25px;
            border-top: 3px solid #d32f2f;
            border-bottom: 3px solid #d32f2f;
            padding: 12px 18px;
            background-color: rgba(255, 255, 255, 0.98);
            flex-shrink: 0;
        }

        #doc-subject-line {
            font-weight: 700;
            color: #1a1a1a;
            display: block;
            font-size: 16px;
            letter-spacing: 0.5px;
            text-transform: none;
        }

        #doc-body {
            margin-bottom: 20px;
            text-align: justify;
            line-height: 1.75;
            letter-spacing: 0.4px;
            flex-shrink: 1;
            min-height: 0;
        }

        #doc-body p {
            margin-bottom: 12px;
            font-size: 15px;
            color: #1a1a1a;
            font-weight: 400;
            text-align: justify;
        }

        #doc-body p:first-child {
            font-weight: 500;
            margin-bottom: 14px;
        }

        #doc-body ul {
            margin: 14px 0 14px 50px;
            padding: 0;
            list-style-type: disc;
        }

        #doc-body ul li {
            margin-bottom: 8px;
            font-size: 15px;
            color: #1a1a1a;
            font-weight: 400;
            text-align: justify;
            line-height: 1.75;
        }

        #doc-body strong {
            color: #d32f2f;
            font-weight: 700;
        }

        #doc-body em {
            font-style: italic;
            font-weight: 500;
        }

        #doc-signatory {
            margin-top: auto;
            padding-top: 20px;
            position: relative;
            flex-shrink: 0;
        }

        .signatory-wrapper {
            display: flex;
            justify-content: flex-start;
            align-items: flex-start;
            position: relative;
            margin-top: 16px;
        }

        .signatory-block {
            text-align: center;
            flex: 1;
            max-width: 280px;
        }

        .signature-line {
            width: 220px;
            height: 70px;
            border-top: 2px solid #000;
            margin: 12px auto 15px auto;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #doc-signatory p {
            margin: 0;
            font-size: 15px;
            margin-bottom: 8px;
            letter-spacing: 0.3px;
        }

        #doc-signatory-name {
            font-weight: 700;
            color: #1a1a1a;
            font-size: 16px;
            text-transform: capitalize;
        }

        #doc-signatory-designation {
            font-size: 14px;
            color: #333;
            font-weight: 600;
            font-style: italic;
        }

        #doc-signatory-org {
            font-size: 14px;
            color: #1a1a1a;
            font-weight: 600;
            margin-top: 6px;
        }

        .stamp-container {
            position: absolute;
            bottom: ${stamp.bottom};
            right: ${stamp.right};
            width: 140px;
            height: 140px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 25;
        }

        .stamp-container img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15));
        }

        @media print {
            * {
                margin: 0;
                padding: 0;
            }

            html, body {
                width: 210mm;
                height: 297mm;
                margin: 0;
                padding: 0;
            }

            body {
                position: relative;
            }

            .page-container {
                width: 210mm;
                height: 297mm;
                padding: 80px 70px 100px 70px;
                page-break-after: avoid;
            }

            .stamp-container {
                position: absolute;
                bottom: ${stamp.bottom};
                right: ${stamp.right};
            }

            .content-wrapper {
                page-break-inside: avoid;
            }
        }

        @media screen {
            body {
                width: 100%;
                height: auto;
                display: flex;
                justify-content: center;
                background: #ddd;
                padding: 20px 0;
            }

            .page-background {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
            }

            .page-container {
                width: 210mm;
                height: 297mm;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
                background: white;
                margin: 20px auto;
                position: relative;
            }
        }
    </style>
</head>
<body>
    <div class="page-background">
        <img src="https://astro-buddy.in/AI/assets/tenderDocuments/TenderBackground.jpeg" 
             alt="Document Background">
    </div>

    <div class="page-container">
        <div class="content-wrapper">
            ${data}
        </div>

        <div class="stamp-container">
            <img src="${stamp.url}" 
                 alt="Official Stamp" 
                 onerror="this.style.display='none'">
        </div>
    </div>
</body>
</html>`;
}

module.exports = { composeTenderLetterHead };
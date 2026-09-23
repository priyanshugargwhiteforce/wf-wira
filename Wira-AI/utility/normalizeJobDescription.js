function normalizeJobDescription(input)
{
    if(typeof input === "string")
    {
        return input.trim();
    }

    if(typeof input === "object" && input !== null)
    {
        const {
            title,
            summary,
            responsibilities = [],
            required_skills = [],
            experience,
            location,
            employment_type
        } = input;

        let output = "";

        if(title)
        {
            output += `Job Title: ${title}\n\n`;
        }
            
        if(summary)
        {
            output += `Summary:\n${summary}\n\n`;
        }

        if(responsibilities.length)
        {
            output += `Responsibilities:\n`;
            for(const item of responsibilities)
            {
                output += `- ${item}\n`;
            }
            output += `\n`;
        }

        if(required_skills.length)
        {
            output += `Required Skills:\n`;
            for(const skill of required_skills)
            {
                output += `- ${skill}\n`;
            }
            output += `\n`;
        }

        if(experience)
        {
            output += `Experience: ${experience}\n`;
        }

        if(location)
        {
            output += `Location: ${location}\n`;
        }

        if(employment_type)
        {
            output += `Employment Type: ${employment_type}\n`;
        }

        return output.trim();
    }

    return "";
}

module.exports = normalizeJobDescription;
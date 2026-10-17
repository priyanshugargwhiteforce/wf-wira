class Utility
{
    //THIS FUNCTION FORMATS THE EXPERIENCE OF THE CANDIDATE FOR EASY AI READIBILITY.
    formatExperience(exp)
    {
        if(exp === null || exp === undefined || exp === "")
        {
            return null;
        }

        const [years, months] = String(exp).split(".").map(Number);
        return `${years} years ${months} months`;
    }
}

const utility = new Utility();
module.exports = utility
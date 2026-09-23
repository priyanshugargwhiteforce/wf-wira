function prepareForEmbedding(structuredData) 
{
    const skills = structuredData.skills?.join(", ") || "";
    
    const education = structuredData.education?.map(edu => `${edu.degree} at ${edu.institution} ${edu.year || ""}`).join("; ") || "";
    const certifications = structuredData.certifications?.map(cert => `${cert.name} by ${cert.issuer} (${cert.year || "N/A"})`).join("; ") || "";
    const projects = structuredData.projects?.map(p => `${p.title}: ${p.description}`).join("; ") || "";
    
    const embeddingString = `${skills}; ${education}; ${certifications}; ${projects}`.trim();
    return embeddingString;
}

module.exports = prepareForEmbedding;
import db from '@/app/api/db'

// LEGACY: This is the legacy risk scores resolver
const riskScores = async () => {
  try {
    const result = await db.query(`
    SELECT
      defaults->>'label' as "label",
      defaults->>'auditScore' as "auditScore",
      defaults->>'codeReviewScore' as "codeReviewScore",
      defaults->>'complexityScore' as "complexityScore",
      defaults->>'protocolSafetyScore' as "protocolSafetyScore",
      defaults->>'teamKnowledgeScore' as "teamKnowledgeScore",
      defaults->>'testingScore' as "testingScore"
    FROM thing
    WHERE
      label = 'risk'
    ORDER BY
      address;`,
    [])

    return result.rows
  } catch (error) {
    console.error(error)
    throw new Error('!vaultReports')
  }
}

export default riskScores

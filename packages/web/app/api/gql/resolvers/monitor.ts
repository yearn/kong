import db from '../../db'

const monitor = async () => {
  try {
    const query = 'SELECT latest FROM monitor;'
    const [singleton] = (await db.query(query)).rows

    // Guard against empty table - return null to let frontend use defaults
    if (!singleton || !singleton.latest) {
      console.warn('Monitor table is empty or has no data')
      return null
    }

    return {
      ...singleton.latest,
      indexStatsJson: JSON.stringify(singleton.latest.indexStats)
    }
  } catch (error) {
    console.error(error)
    throw new Error('Failed to run monitor')
  }
}

export default monitor

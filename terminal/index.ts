import dotenv from 'dotenv'
import path from 'path'
import figlet from 'figlet'
import chalk from 'chalk'
import { menuPrompt } from './menu'

const envPath = path.join(__dirname, '..', '.env')
dotenv.config({ path: envPath })

async function main() {
  console.log()
  console.log(chalk.yellowBright(figlet.textSync('KONG', { font: 'Cyberlarge', horizontalLayout: 'fitted' })))
  console.log()

  while(true) { await menuPrompt() }
}

main().then(() => process.exit(0)).catch(error => {
  console.error('🤬', error)
  process.exit(1)
})

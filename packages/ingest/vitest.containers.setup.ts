import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'
import chai from 'chai'
import chaiAlmost from 'chai-almost'

// load .env so RPC URLs reach the ingest container via TestEnvironment
dotenv.config({ path: path.join(__dirname, '../..', '.env') })
chai.use(chaiAlmost())

import 'dotenv/config';
import { app } from './app.js';
import prisma from './prisma.js';

const PORT = Number(process.env.PORT ?? 5001);

async function startServer() {
  try {
    await prisma.$connect();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
}

startServer();

import express from 'express';
import { resolve } from 'path';

const router = express.Router();

router.get('/', (req, res) => res.send('Welcome to my webserver'));

/* 
    Always serve the same html file since this is a single page app
    React will handle the routing on the client
  */
router.all('*', (req, res) =>
  res.sendFile(resolve(__dirname, 'public', 'index.html'))
);

export default router;

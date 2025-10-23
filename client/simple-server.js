const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// Serve simple HTML for testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>PDF2CSV - Test</title>
    </head>
    <body>
        <h1>PDF2CSV Application</h1>
        <p>Frontend is working!</p>
        <p>Backend URL: <a href="https://pdf2csv-backend-805037964827.us-central1.run.app/api/collections" target="_blank">https://pdf2csv-backend-805037964827.us-central1.run.app</a></p>
        <p>Test API: <a href="https://pdf2csv-backend-805037964827.us-central1.run.app/api/collections" target="_blank">Collections API</a></p>
        <p>Port: ${port}</p>
    </body>
    </html>
  `);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});

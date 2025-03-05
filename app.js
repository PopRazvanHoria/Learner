const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/save-card', (req, res) => {
    const { imageData, blurRegions, frequencyCategory } = req.body;
    console.log('Received request to save card');
    console.log('Image data length:', imageData.length);
    console.log('Blur regions:', blurRegions);
    console.log('Frequency category:', frequencyCategory);

    try {
        const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
        const imageName = `card_${Date.now()}.png`;
        const imagePath = path.join(__dirname, 'public', 'cards', imageName);
        const metadata = {
            blurRegions,
            frequencyCategory,
            imagePath: `/cards/${imageName}`
        };
        const metadataPath = path.join(__dirname, 'public', 'cards', `${imageName}.json`);

        // Ensure the cards directory exists
        if (!fs.existsSync(path.join(__dirname, 'public', 'cards'))) {
            fs.mkdirSync(path.join(__dirname, 'public', 'cards'));
        }

        fs.writeFile(imagePath, imageBuffer, (err) => {
            if (err) {
                console.error('Error saving image:', err);
                return res.status(500).json({ error: 'Error saving image', details: err.message });
            }
            fs.writeFile(metadataPath, JSON.stringify(metadata), (err) => {
                if (err) {
                    console.error('Error saving metadata:', err);
                    return res.status(500).json({ error: 'Error saving metadata', details: err.message });
                }
                console.log('Card saved successfully:', imageName);
                res.json({ message: 'Card saved successfully' });
            });
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Unexpected error', details: error.message });
    }
});

app.get('/get-cards', (req, res) => {
    const cardsDir = path.join(__dirname, 'public', 'cards');
    console.log('Reading cards from directory:', cardsDir);
    fs.readdir(cardsDir, (err, files) => {
        if (err) {
            console.error('Error reading cards directory:', err);
            return res.status(500).json({ error: 'Error reading cards directory', details: err.message });
        }

        const cards = files
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const filePath = path.join(cardsDir, file);
                console.log('Reading card file:', filePath);
                const card = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return card;
            });

        console.log('Cards fetched:', cards);
        res.json(cards);
    });
});

app.post('/update-card', (req, res) => {
    const card = req.body;
    const metadataPath = path.join(__dirname, 'public', 'cards', `${path.basename(card.imagePath)}.json`);

    fs.writeFile(metadataPath, JSON.stringify(card), (err) => {
        if (err) {
            console.error('Error updating card metadata:', err);
            return res.status(500).json({ error: 'Error updating card metadata', details: err.message });
        }
        res.json({ message: 'Card updated successfully' });
    });
});

app.post('/create-test-folder', (req, res) => {
    const testFolderPath = path.join(__dirname, 'test-folder');
    const testFilePath = path.join(testFolderPath, 'test-file.txt');

    // Ensure the test folder exists
    if (!fs.existsSync(testFolderPath)) {
        fs.mkdirSync(testFolderPath);
    }

    fs.writeFile(testFilePath, 'This is a test file.', (err) => {
        if (err) {
            console.error('Error creating test file:', err);
            return res.status(500).json({ error: 'Error creating test file', details: err.message });
        }
        console.log('Test file created successfully');
        res.json({ message: 'Test file created successfully' });
    });
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});

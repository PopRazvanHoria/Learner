const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/cards', (req, res, next) => {
    console.log(`Serving card image: ${req.url}`); // Debugging line
    next();
}, express.static(path.join(__dirname, 'cards')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/save-card', async (req, res) => {
    const { imageData, blurRegions, frequencyCategory } = req.body;
    console.log('Received request to save card');
    console.log('Image data length:', imageData.length);
    console.log('Blur regions:', blurRegions);
    console.log('Frequency category:', frequencyCategory);

    try {
        const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
        const imageName = `card_${Date.now()}.png`;
        const imagePath = path.join(__dirname, 'cards', imageName);
        const metadata = {
            blurRegions,
            frequencyCategory,
            imagePath: `/cards/${imageName}`
        };
        const metadataPath = path.join(__dirname, 'cards', `${imageName}.json`);

        // Ensure the cards directory exists
        await fs.mkdir(path.join(__dirname, 'cards'), { recursive: true });

        await fs.writeFile(imagePath, imageBuffer);
        await fs.writeFile(metadataPath, JSON.stringify(metadata));
        console.log('Card saved successfully:', imageName);
        res.json({ message: 'Card saved successfully' });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Unexpected error', details: error.message });
    }
});

app.get('/get-cards', (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    console.log('Reading cards from directory:', cardsDir);
    fs.readdir(cardsDir, (err, files) => {
        if (err) {
            console.error('Error reading cards directory:', err);
            return res.status(500).json({ error: 'Error reading cards directory', details: err.message });
        }

        const cards = files
            .filter(file => file.endsWith('.png'))
            .map(file => {
                const imagePath = path.join(cardsDir, file);
                const metadataPath = path.join(cardsDir, `${file}.json`);
                console.log('Reading card file:', imagePath);
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                    metadata.imagePath = `/cards/${file}`;
                    return metadata;
                } catch (readErr) {
                    console.error('Error reading card metadata file:', readErr);
                    return null;
                }
            })
            .filter(card => card !== null);

        console.log('Cards fetched:', cards);
        res.json(cards);
    });
});

app.get('/get-card/:index', (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    fs.readdir(cardsDir, (err, files) => {
        if (err) {
            console.error('Error reading cards directory:', err);
            return res.status(500).json({ error: 'Error reading cards directory', details: err.message });
        }

        const cardFiles = files.filter(file => file.endsWith('.png'));
        const index = parseInt(req.params.index, 10);

        if (index < 0 || index >= cardFiles.length) {
            return res.status(404).json({ error: 'Card not found' });
        }

        const file = cardFiles[index];
        const metadataPath = path.join(cardsDir, `${file}.json`);
        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            metadata.imagePath = `/cards/${file}`;
            res.json(metadata);
        } catch (readErr) {
            console.error('Error reading card metadata file:', readErr);
            res.status(500).json({ error: 'Error reading card metadata file', details: readErr.message });
        }
    });
});

app.post('/update-card', (req, res) => {
    const card = req.body;
    const metadataPath = path.join(__dirname, 'cards', `${path.basename(card.imagePath)}.json`);

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

app.delete('/delete-card/:index', (req, res) => {
    const cardsDir = path.join(__dirname, 'cards');
    fs.readdir(cardsDir, (err, files) => {
        if (err) {
            console.error('Error reading cards directory:', err);
            return res.status(500).json({ error: 'Error reading cards directory', details: err.message });
        }

        const cardFiles = files.filter(file => file.endsWith('.png'));
        const index = parseInt(req.params.index, 10);

        if (index < 0 || index >= cardFiles.length) {
            return res.status(404).json({ error: 'Card not found' });
        }

        const file = cardFiles[index];
        const imagePath = path.join(cardsDir, file);
        const metadataPath = path.join(cardsDir, `${file}.json`);

        fs.unlink(imagePath, (err) => {
            if (err) {
                console.error('Error deleting card image:', err);
                return res.status(500).json({ error: 'Error deleting card image', details: err.message });
            }

            fs.unlink(metadataPath, (err) => {
                if (err) {
                    console.error('Error deleting card metadata:', err);
                    return res.status(500).json({ error: 'Error deleting card metadata', details: err.message });
                }

                res.json({ message: 'Card deleted successfully' });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});

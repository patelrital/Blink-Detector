const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const IntegratedBlinkTest = require('./integrated-test.js');

let mainWindow;
let blinkTest;
let inputResolve = null;
let recipeInProgress = false;
let currentRecipe = [];
let recipeIndex = 0;
let isRecipeRunning = false;
let shouldStopRecipe = false;
let detectionStarted = false;      // New
let detectionInitialized = false;  // New

// Override readline.createInterface to use our UI
const originalCreateInterface = require('readline').createInterface;
require('readline').createInterface = function(options) {
    const rl = originalCreateInterface({
        input: process.stdin,
        output: process.stdout,
        ...options
    });
    
    const originalQuestion = rl.question;
    rl.question = function(query, callback) {
        mainWindow.webContents.send('log-message', query);
        mainWindow.webContents.send('request-input');
        
        const promise = new Promise(resolve => {
            inputResolve = resolve;
        });
        
        promise.then(answer => {
            callback(answer);
        });
        
        return this;
    };
    
    return rl;
};

// Override console.log to send to renderer
const originalConsoleLog = console.log;
console.log = (...args) => {
    originalConsoleLog.apply(console, args);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('log-message', args.join(' '));
    }
};

// Add this constant near the top with other constants
const COMMAND_DELAY = 1000; // 1 second delay between commands

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
    
    // Only open DevTools if explicitly running in dev mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle terminal input from the UI
ipcMain.on('terminal-input', (_, input) => {
    if (inputResolve) {
        inputResolve(input);
        inputResolve = null;
    }
});

ipcMain.on('start-detection', async () => {
    try {
        blinkTest = new IntegratedBlinkTest();
        await blinkTest.initialize();
        
        // Override the test duration to run indefinitely
        blinkTest.testDuration = Number.MAX_SAFE_INTEGER;
        
        // Modify the log function to send to renderer
        const originalLog = blinkTest.log;
        blinkTest.log = (message) => {
            originalLog.call(blinkTest, message);
            mainWindow.webContents.send('log-message', message);
        };
        
        blinkTest.startTest();
        mainWindow.webContents.send('detection-started');
    } catch (error) {
        mainWindow.webContents.send('log-message', `Error: ${error.message}`);
    }
});

ipcMain.on('stop-detection', async () => {
    if (blinkTest) {
        try {
            await blinkTest.cleanup();
            blinkTest = null;
            mainWindow.webContents.send('detection-stopped');
        } catch (error) {
            mainWindow.webContents.send('log-message', `Error during cleanup: ${error.message}`);
        }
    }
});

// Add new handler for opening logs folder
ipcMain.on('open-logs-folder', () => {
    if (blinkTest) {
        const logsPath = blinkTest.getLogDirectory();
        mainWindow.webContents.send('logs-folder-path', logsPath);
    } else {
        // If blinkTest hasn't been initialized yet, we can create a new instance
        // just to get the logs path
        const tempTest = new IntegratedBlinkTest();
        const logsPath = tempTest.getLogDirectory();
        mainWindow.webContents.send('logs-folder-path', logsPath);
    }
});

// Replace the existing 'execute-recipe-command' handler
ipcMain.on('execute-recipe-command', async (event, { command, param }) => {
    try {
        await executeRecipeCommand(command, param);
        event.reply('command-completed');
    } catch (error) {
        console.error(`Error executing command ${command}:`, error);
        mainWindow.webContents.send('log-message', `Error: ${error.message}`);
        event.reply('command-completed');
    }
});

// Replace the existing 'run-recipe' handler
ipcMain.on('run-recipe', async (event, { commands, loop, count }) => {
    if (isRecipeRunning) return;
    
    isRecipeRunning = true;
    shouldStopRecipe = false;
    let currentLoop = 0;

    try {
        // Switch to detection tab before starting recipe execution
        mainWindow.webContents.send('switch-to-detection');
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for tab switch
        
        mainWindow.webContents.send('log-message', 'Starting recipe execution...');
        
        do {
            currentLoop++;
            mainWindow.webContents.send('log-message', `Starting loop ${currentLoop}/${count}`);
            
            for (const cmd of commands) {
                if (shouldStopRecipe) break;

                const [command, param] = cmd.split(',');
                mainWindow.webContents.send('log-message', `Executing: ${command}`);
                await executeRecipeCommand(command, param);
                mainWindow.webContents.send('log-message', `Completed: ${command}`);
            }
        } while (loop && currentLoop < count && !shouldStopRecipe);

        mainWindow.webContents.send('recipe-complete');
        mainWindow.webContents.send('log-message', 'Recipe execution completed');
    } catch (error) {
        mainWindow.webContents.send('recipe-error', error.message);
        mainWindow.webContents.send('log-message', `Error: ${error.message}`);
    } finally {
        isRecipeRunning = false;
        shouldStopRecipe = false;
    }
});

// Replace the existing 'stop-recipe' handler
ipcMain.on('stop-recipe', () => {
    shouldStopRecipe = true;
    if (blinkTest) {
        stopFlickerDetection();
    }
});

// Add these new IPC listeners
ipcMain.on('detection-fully-initialized', () => {
    detectionInitialized = true;
});

ipcMain.on('detection-started', () => {
    detectionStarted = true;
});

ipcMain.on('detection-stopped', () => {
    detectionStarted = false;
    detectionInitialized = false;
});

// Add this new helper function
async function waitForDetectionStart() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (detectionInitialized) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 1000);
    });
}

// Replace the existing executeRecipeCommand function
async function executeRecipeCommand(command, param) {
    mainWindow.webContents.send('recipe-command-start', command);
    console.log(`Executing command: ${command}`);
    
    try {
        switch (command) {
            case 'startDetection':
                console.log('Triggering start detection...');
                detectionInitialized = false;
                mainWindow.webContents.send('switch-to-detection');
                await new Promise(resolve => setTimeout(resolve, 500));
                mainWindow.webContents.send('trigger-start-button');
                
                // Wait for detection to be fully initialized
                console.log('Waiting for detection initialization...');
                await waitForDetectionStart();
                console.log('Detection initialized successfully');
                break;

            case 'endDetection':
                console.log('Triggering end detection...');
                if (!detectionInitialized) {
                    console.log('Detection not running, skipping end command');
                    return;
                }
                mainWindow.webContents.send('switch-to-detection');
                await new Promise(resolve => setTimeout(resolve, 500));
                mainWindow.webContents.send('trigger-stop-button');
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;

            case 'delay':
                const delay = parseInt(param) || 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                break;
            case 'turnOnAcPower':
                await executeSerialCommand('c');
                break;
            case 'turnOffAcPower':
                await executeSerialCommand('d');
                break;
            case 'sleepSystem':
                await executeSerialCommand('m');
                break;
            case 'wakeSystem':
                await executeSerialCommand('b');
                break;
            case 'snapshotDeviceManager':
                const DeviceSnapshotComparer = require('./DeviceSnapshotComparer');
                const comparer = new DeviceSnapshotComparer();
                await comparer.initialize();
                const snapshot = await comparer.takeSnapshot();
                global.lastSnapshot = global.lastSnapshot || [];
                global.lastSnapshot.push(snapshot);
                
                if (global.lastSnapshot.length === 2) {
                    const changes = comparer.compareSnapshots(
                        global.lastSnapshot[0],
                        global.lastSnapshot[1]
                    );
                    await comparer.saveChangesToFile(changes);
                    global.lastSnapshot = [];
                }
                break;
            default:
                throw new Error(`Unknown command: ${command}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, COMMAND_DELAY));
        mainWindow.webContents.send('recipe-command-complete', command);
    } catch (error) {
        console.error(`Error executing ${command}:`, error);
        mainWindow.webContents.send('recipe-error', error.message);
        throw error;
    }
}

// Add new helper function for serial commands
async function executeSerialCommand(command) {
    const DeviceSerialPort = require('./serialport');
    const device = new DeviceSerialPort();
    await device.initialize();
    
    try {
        switch(command) {
            case 'c': await device.ACOn(); break;
            case 'd': await device.ACOff(); break;
            case 'm': await device.MagnetOff(); break;
            case 'b': await device.MagnetOn(); break;
        }
    } finally {
        await device.close();
    }
}

// Add these helper functions
async function startFlickerDetection() {
    if (!blinkTest) {
        blinkTest = new IntegratedBlinkTest();
        await blinkTest.initialize();
        blinkTest.testDuration = Number.MAX_SAFE_INTEGER;
        
        const originalLog = blinkTest.log;
        blinkTest.log = (message) => {
            originalLog.call(blinkTest, message);
            mainWindow.webContents.send('log-message', message);
        };
        
        blinkTest.startTest();
        mainWindow.webContents.send('detection-started');
    }
}

async function stopFlickerDetection() {
    if (blinkTest) {
        await blinkTest.cleanup();
        blinkTest = null;
        mainWindow.webContents.send('detection-stopped');
    }
}

// Add new IPC handler for quick commands
ipcMain.on('execute-quick-command', async (event, command) => {
    try {
        const [cmd, param] = command.split(',');
        await executeRecipeCommand(cmd, param);
        event.reply('quick-command-completed');
    } catch (error) {
        console.error(`Error executing quick command ${command}:`, error);
        mainWindow.webContents.send('log-message', `Error: ${error.message}`);
        event.reply('quick-command-completed');
    }
});

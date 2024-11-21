// clear-ports.js
const { SerialPort } = require('serialport');

async function clearAllPorts() {
    console.log('Cleaning up serial ports...');
    
    try {
        const ports = await SerialPort.list();
        
        if (ports.length === 0) {
            console.log('No serial ports found');
            return;
        }

        console.log(`Found ${ports.length} ports to check`);
        
        for (const port of ports) {
            console.log(`\nChecking port: ${port.path}`);
            
            const testPort = new SerialPort({
                path: port.path,
                baudRate: 9600,
                autoOpen: false
            });

            await new Promise((resolve) => {
                testPort.open((err) => {
                    if (err) {
                        console.log(`Port ${port.path} is busy or unavailable`);
                        resolve();
                        return;
                    }
                    
                    console.log(`Clearing port ${port.path}`);
                    testPort.close((closeErr) => {
                        if (closeErr) {
                            console.warn(`Warning while closing ${port.path}: ${closeErr.message}`);
                        } else {
                            console.log(`Successfully cleared ${port.path}`);
                        }
                        resolve();
                    });
                });
            });
        }
        
        console.log('\nPort cleanup completed');
        
    } catch (error) {
        console.error('Error during port cleanup:', error.message);
    }
}

// Run the cleanup
console.log('Starting Port Cleanup Utility');
console.log('============================\n');

clearAllPorts().then(() => {
    console.log('\nCleanup finished. You can now run your tests.');
    process.exit(0);
}).catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
const { SerialPort } = require('serialport');
const { SerialPortStream } = require('@serialport/stream');
const { autoDetect } = require('@serialport/bindings-cpp');
const EventEmitter = require('events');
const readline = require('readline');

// Static variable for port persistence across instances
let savedPortPath = null;

class DeviceSerialPort extends EventEmitter {
    constructor(baudRate = 9600) {
        super();
        this.baudRate = baudRate;
        this.port = null;
        this.portPath = null;
        this.isBusy = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
    }

    createInterface() {
        return readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async getUserConfirmation(question) {
        const rl = this.createInterface();
        try {
            const answer = await new Promise(resolve => {
                rl.question(question, resolve);
            });
            return answer.toLowerCase();
        } finally {
            rl.close();
        }
    }

    async selectPort() {
        try {
            // First check if we have a saved port and if it's still available
            if (savedPortPath) {
                const ports = await SerialPort.list();
                const savedPortExists = ports.some(port => port.path === savedPortPath);
                
                if (savedPortExists) {
                    console.log(`Using saved port: ${savedPortPath}`);
                    return savedPortPath;
                } else {
                    console.log('Saved port no longer available, selecting new port...');
                    savedPortPath = null;
                }
            }

            const ports = await SerialPort.list();
            
            if (ports.length === 0) {
                throw new Error('No serial ports found');
            }

            console.log('\nAvailable ports:');
            ports.forEach((port, index) => {
                console.log(`[${index + 1}] Path: ${port.path}`);
                if (port.manufacturer) console.log(`    Manufacturer: ${port.manufacturer}`);
                if (port.serialNumber) console.log(`    Serial Number: ${port.serialNumber}`);
                if (port.vendorId) console.log(`    Vendor ID: ${port.vendorId}`);
                if (port.productId) console.log(`    Product ID: ${port.productId}`);
                console.log('---');
            });

            const rl = this.createInterface();
            
            while (true) {
                const portNumber = await new Promise(resolve => {
                    rl.question('\nSelect port number (1-' + ports.length + '): ', resolve);
                });

                const index = parseInt(portNumber) - 1;
                if (index >= 0 && index < ports.length) {
                    const selectedPort = ports[index];
                    
                    const confirm = await new Promise(resolve => {
                        rl.question('Is this the correct port? (y/n): ', resolve);
                    });

                    if (confirm.toLowerCase() === 'y') {
                        rl.close();
                        // Save the port for future use
                        savedPortPath = selectedPort.path;
                        return selectedPort.path;
                    }
                } else {
                    console.log('Invalid selection, please try again');
                }
            }
        } catch (error) {
            throw error;
        }
    }

    async forceClearPort(portPath) {
        return new Promise((resolve) => {
            const testPort = new SerialPort({
                path: portPath,
                baudRate: this.baudRate,
                autoOpen: false
            });

            testPort.open((err) => {
                if (!err) {
                    testPort.close(() => {
                        setTimeout(resolve, 1000);
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    async initialize() {
        try {
            if (this.port && this.port.isOpen) {
                await this.close();
            }

            this.portPath = await this.selectPort();
            await this.forceClearPort(this.portPath);

            console.log(`Initializing port ${this.portPath}`);
            
            this.port = new SerialPort({
                path: this.portPath,
                baudRate: this.baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                autoOpen: false,
                rtscts: true
            });

            await this.openPort();
            this.setupDataListener();
            
            return true;
        } catch (error) {
            // If there's an error with the saved port, clear it and try again
            if (savedPortPath === this.portPath) {
                console.log('Error with saved port, clearing saved port and retrying...');
                savedPortPath = null;
                return await this.initialize();
            }
            throw error;
        }
    }

    async openPort() {
        return new Promise((resolve, reject) => {
            this.port.open((error) => {
                if (error) {
                    reject(new Error(`Failed to open port: ${error.message}`));
                    return;
                }
                
                this.port.on('error', this.handlePortError.bind(this));
                resolve();
            });
        });
    }

    handlePortError(error) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.initialize().catch(() => {});
        } else {
            this.emit('error', error);
        }
    }

    setupDataListener() {
        let buffer = '';
        this.port.on('data', (data) => {
            const received = data.toString();
            buffer += received;
            const messages = buffer.split('\n');
            buffer = messages.pop();
            
            for (const message of messages) {
                this.processResponse(message.trim());
            }
        });

        this.port.on('error', (error) => {
            this.emit('error', error);
        });
    }

    processResponse(response) {
        if (!response) return;

        this.isBusy = false;

        const matches = response.match(/^(\d+\.\d+),\s*(\d+\.\d+)$/);
        if (matches) {
            const data = {
                value1: parseFloat(matches[1]),
                value2: parseFloat(matches[2])
            };
            this.emit('data', data);
            this.emit('response', response);
        } else {
            this.emit('response', response);
        }
    }

    async changePort() {
        // Clear saved port when explicitly changing ports
        savedPortPath = null;
        if (this.port && this.port.isOpen) {
            await this.close();
        }
        await this.initialize();
    }

    async sendCommand(command) {
        let busyWaitTime = 0;
        const MAX_BUSY_WAIT = 1000;
        
        while (this.isBusy) {
            await new Promise(resolve => setTimeout(resolve, 10));
            busyWaitTime += 10;
            
            if (busyWaitTime >= MAX_BUSY_WAIT) {
                this.isBusy = false;
                break;
            }
        }
        
        this.isBusy = true;
        
        return new Promise((resolve, reject) => {
            this.port.write(command + '\n', (error) => {
                if (error) {
                    this.isBusy = false;
                    reject(new Error(`Failed to send command: ${error.message}`));
                    return;
                }
                
                setTimeout(() => {
                    if (this.isBusy) {
                        this.isBusy = false;
                    }
                }, 100);
                
                resolve();
            });
        });
    }

    async ReadSensor() {
        try {
            await this.sendCommand('s');
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.isBusy = false;
                    reject(new Error('Sensor read timeout'));
                }, 5000);

                const handleResponse = (data) => {
                    clearTimeout(timeout);
                    
                    const matches = data.match(/^(\d+\.\d+),\s*(\d+\.\d+)$/);
                    if (matches) {
                        resolve({
                            value1: parseFloat(matches[1]),
                            value2: parseFloat(matches[2])
                        });
                    } else {
                        reject(new Error('Invalid sensor data format'));
                    }
                };

                const handleError = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };

                this.once('response', handleResponse);
                this.once('error', handleError);

                timeout.unref();
            });
        } catch (error) {
            throw error;
        }
    }

    async MagnetOn() {
        try {
            await this.sendCommand('b');
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async MagnetOff() {
        try {
            await this.sendCommand('m');
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async ACOn() {
        try {
            await this.sendCommand('c');
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async ACOff() {
        try {
            await this.sendCommand('d');
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async close() {
        if (!this.port) return;

        return new Promise((resolve) => {
            const cleanup = () => {
                this.port = null;
                this.portPath = null;
                this.isBusy = false;
                resolve();
            };

            if (this.port.isOpen) {
                this.port.close((error) => {
                    cleanup();
                });
            } else {
                cleanup();
            }
        });
    }

    // Static method to explicitly clear the saved port if needed
    static clearSavedPort() {
        savedPortPath = null;
        console.log('Cleared saved port configuration');
    }
}

module.exports = DeviceSerialPort;
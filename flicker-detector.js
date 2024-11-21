const DeviceSerialPort = require('./serialport');

class FlickerDetector {
    constructor() {
        this.device = new DeviceSerialPort();
        this.isOn = false;
        this.wasOn = false;
        this.lastValue = null;
        this.threshold = 0.75;
        this.blinkCount = 0;
    }

    async initialize() {
        console.log('Initializing flicker detector...');
        await this.device.initialize();
        console.log('✓ Connected to port:', this.device.portPath);
    }

    detectStateChange(currentValue) {
        if (this.lastValue === null) {
            this.lastValue = currentValue;
            return false;
        }

        const change = currentValue - this.lastValue;
        this.lastValue = currentValue;
        
        this.isOn = change >= this.threshold;
        return true;
    }

    logBlink() {
        this.blinkCount++;
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Blink detected! (Total blinks: ${this.blinkCount})`);
    }

    async cleanup() {
        console.log('\nCleaning up...');
        await this.device.close();
        console.log('✓ Device closed successfully');
    }
}

module.exports = FlickerDetector;
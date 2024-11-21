const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class DeviceSnapshotComparer {
    constructor() {
        this.snapshotPath = path.join(__dirname, 'snapshots');
        this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    }

    async initialize() {
        try {
            await fs.mkdir(this.snapshotPath, { recursive: true });
            console.log('Snapshot directory initialized');
            
            // Test if we have admin PowerShell access
            await this.testPowerShellAccess();
            
        } catch (error) {
            console.error('Error initializing:', error);
            throw error;
        }
    }

    async testPowerShellAccess() {
        return new Promise((resolve, reject) => {
            // Simple test command to check PowerShell access
            exec('powershell.exe -Command "Write-Host test"', (error, stdout) => {
                if (error) {
                    console.error('\nERROR: PowerShell access failed.');
                    console.error('Please run this script as Administrator. Right-click PowerShell and select "Run as Administrator".\n');
                    reject(new Error('PowerShell access denied'));
                    return;
                }
                resolve();
            });
        });
    }

    async takeSnapshot() {
        return new Promise((resolve, reject) => {
            // PowerShell command wrapped in double quotes with proper escaping
            const psCommand = `powershell.exe -Command "&{Get-CimInstance Win32_PnPEntity | Select-Object Status,Caption,Name,DeviceID | ConvertTo-Json}"`;
            
            exec(psCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing command:', error);
                    reject(error);
                    return;
                }

                try {
                    // Parse and sort the device list for consistent comparison
                    const devices = JSON.parse(stdout);
                    const sortedDevices = Array.isArray(devices) ? devices : [devices];
                    
                    // Map the WMI object properties to match our desired format
                    const mappedDevices = sortedDevices.map(device => ({
                        Status: device.Status || 'Unknown',
                        Class: device.Caption ? device.Caption.split('(')[0].trim() : 'Unknown',
                        FriendlyName: device.Name || 'Unknown',
                        InstanceId: device.DeviceID || 'Unknown'
                    })).filter(device => device.InstanceId !== 'Unknown'); // Filter out devices without IDs

                    // Sort by InstanceId for consistent comparison
                    mappedDevices.sort((a, b) => a.InstanceId.localeCompare(b.InstanceId));
                    
                    resolve(mappedDevices);
                } catch (parseError) {
                    console.error('Error parsing device information:', parseError);
                    reject(parseError);
                }
            });
        });
    }

    compareSnapshots(snapshot1, snapshot2) {
        const changes = {
            added: [],
            removed: [],
            modified: []
        };

        // Create maps for easier comparison
        const map1 = new Map(snapshot1.map(device => [device.InstanceId, device]));
        const map2 = new Map(snapshot2.map(device => [device.InstanceId, device]));

        // Find added and modified devices
        for (const [id, device2] of map2) {
            const device1 = map1.get(id);
            if (!device1) {
                changes.added.push(device2);
            } else if (JSON.stringify(device1) !== JSON.stringify(device2)) {
                changes.modified.push({
                    before: device1,
                    after: device2
                });
            }
        }

        // Find removed devices
        for (const [id, device1] of map1) {
            if (!map2.has(id)) {
                changes.removed.push(device1);
            }
        }

        return changes;
    }

    async saveChangesToFile(changes) {
        const outputPath = path.join(this.snapshotPath, `device_changes_${this.timestamp}.txt`);
        
        let content = 'Device Manager Changes Report\n';
        content += `Generated: ${new Date().toISOString()}\n\n`;

        // Format added devices
        if (changes.added.length > 0) {
            content += '=== Added Devices ===\n';
            changes.added.forEach(device => {
                content += `\nDevice: ${device.FriendlyName}\n`;
                content += `Class: ${device.Class}\n`;
                content += `Status: ${device.Status}\n`;
                content += `Instance ID: ${device.InstanceId}\n`;
            });
        }

        // Format removed devices
        if (changes.removed.length > 0) {
            content += '\n=== Removed Devices ===\n';
            changes.removed.forEach(device => {
                content += `\nDevice: ${device.FriendlyName}\n`;
                content += `Class: ${device.Class}\n`;
                content += `Status: ${device.Status}\n`;
                content += `Instance ID: ${device.InstanceId}\n`;
            });
        }

        // Format modified devices
        if (changes.modified.length > 0) {
            content += '\n=== Modified Devices ===\n';
            changes.modified.forEach(change => {
                content += `\nDevice: ${change.after.FriendlyName}\n`;
                content += 'Changes:\n';
                for (const key of ['Status', 'Class', 'FriendlyName']) {
                    if (change.before[key] !== change.after[key]) {
                        content += `${key}: ${change.before[key]} -> ${change.after[key]}\n`;
                    }
                }
                content += `Instance ID: ${change.after.InstanceId}\n`;
            });
        }

        // Add summary
        content += '\n=== Summary ===\n';
        content += `Added devices: ${changes.added.length}\n`;
        content += `Removed devices: ${changes.removed.length}\n`;
        content += `Modified devices: ${changes.modified.length}\n`;

        try {
            await fs.writeFile(outputPath, content, 'utf8');
            console.log(`Changes saved to: ${outputPath}`);
            return outputPath;
        } catch (error) {
            console.error('Error saving changes to file:', error);
            throw error;
        }
    }
}

module.exports = DeviceSnapshotComparer;
# Blink Detection System

## Overview
This system integrates hardware sensors and camera recording to detect and document blink events. It uses serial communication for sensor data and FFmpeg for video capture, providing synchronized logging of both sensor readings and video recordings.

## Features
- Real-time blink detection using dual sensors
- Synchronized video recording with blink event markers
- Automatic video segmentation and cleanup
- CSV logging of blink events
- Device manager snapshot comparison
- Configurable calibration system
- Port management and recovery

## Prerequisites
- Node.js (v14 or higher)
- FFmpeg installed and added to system PATH
- Windows OS (for Device Manager functionality)
- Administrator privileges (for Device Manager snapshots)
- Compatible hardware sensors connected via serial port

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/blink-detection-system.git
   cd blink-detection-system
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure settings:
   - Copy `config.example.json` to `config.json`
   - Adjust serial port, video, and sensor settings as needed

## Usage

1. Start the system:
   ```bash
   npm start
   ```

2. Calibration:
   - Follow the on-screen prompts for sensor calibration
   - Verify sensor readings are within expected ranges
   - Adjust threshold values if needed in config.json

3. Recording:
   - Press 'R' to start recording
   - Press 'S' to stop recording
   - Press 'Q' to quit the application

## Output Files

- `/videos`: Contains recorded video segments
- `/logs`: Contains CSV files with blink event data
- `/snapshots`: Device manager comparison snapshots

## Troubleshooting

1. Serial Port Issues:
   - Verify correct COM port in config.json
   - Check device manager for port conflicts
   - Run application with administrator privileges

2. Video Recording Issues:
   - Ensure FFmpeg is properly installed
   - Check available disk space
   - Verify camera permissions


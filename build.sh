#!/bin/bash

# Build and run the Heartlands app with Docker

echo "Building Heartlands Docker image..."
docker build -t heartlands-app .

echo "Starting Heartlands app container..."
docker run -d -p 3000:80 --name heartlands-app heartlands-app

echo "App is running at http://localhost:3000"
echo "To stop the app, run: docker stop heartlands-app"
echo "To remove the container, run: docker rm heartlands-app"

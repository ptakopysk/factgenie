#!/bin/bash

#authbind --deep gunicorn factgenie.cli:create_app -b 0.0.0.0:80 -w 1 --threads 8
authbind --deep gunicorn factgenie.bin.run:create_app -b 0.0.0.0:80 -w 1 --threads 8

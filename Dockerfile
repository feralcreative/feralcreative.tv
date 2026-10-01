FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static files
COPY index.html /usr/share/nginx/html/
COPY skyline.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY obs-stream.js /usr/share/nginx/html/
COPY config.js /usr/share/nginx/html/
COPY auth.js /usr/share/nginx/html/
COPY onvif-controls.js /usr/share/nginx/html/
COPY styles /usr/share/nginx/html/styles
COPY images /usr/share/nginx/html/images

# Force rebuild timestamp
RUN echo "Build: $(date)"

# Expose port 80 (nginx.conf listens on 80; the host publishes it as 54999)
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]

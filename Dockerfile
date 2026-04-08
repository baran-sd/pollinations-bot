# Используем официальный образ Node.js
FROM node:20-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы проекта
COPY package.json package-lock.json ./

# Устанавливаем зависимости
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    iputils-ping \
    dnsutils \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --production

# Копируем остальной код
COPY . .

# Открываем порт 7860 (стандарт Hugging Face)
EXPOSE 7860

# Переменная окружения для порта
ENV PORT=7860

# Запускаем бота
CMD ["npm", "start"]

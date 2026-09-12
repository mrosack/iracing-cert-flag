FROM node:20-slim AS build
WORKDIR /build
COPY package.json package-lock.json* tsconfig.json ./
COPY src/ ./src/
RUN npm install
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:20

RUN dnf install -y poppler-utils fontconfig dejavu-sans-fonts && dnf clean all

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /build/dist/ ./

CMD ["handler.handler"]

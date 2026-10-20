/**
 * pdf_compiler.js — Сборщик фото домашки и конспектов в один красивый PDF для учителей
 */

const { PDFDocument } = require("pdf-lib");

async function createPdfFromImages(imageBuffers, title = "Домашка от Лам") {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setAuthor("LUM • AI Assistant");

  for (let i = 0; i < imageBuffers.length; i++) {
    const buf = imageBuffers[i];
    let img;
    try {
      img = await pdfDoc.embedJpg(buf);
    } catch {
      try {
        img = await pdfDoc.embedPng(buf);
      } catch (err) {
        console.warn(`[PDF] Не удалось встроить страницу #${i + 1}:`, err.message);
        continue;
      }
    }

    if (img) {
      // Стандартный A4 или пропорциональный странице размер
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { createPdfFromImages };

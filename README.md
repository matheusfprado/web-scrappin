# Web Scrappin

Ferramenta em Node.js para pesquisar produtos em marketplaces brasileiros, coletar dados públicos de listagens e ordenar os resultados por menor preço.

O projeto oferece scripts de linha de comando para Mercado Livre, Amazon, Shein e Shopee. Também inclui uma API HTTP simples para executar buscas — com seletores prontos para o Mercado Livre e suporte a seletores informados pelo cliente em outros sites.

## O que o projeto coleta

Cada resultado contém:

- título do produto;
- preço exibido;
- link do anúncio;
- desconto exibido, quando disponível.

Os resultados são normalizados, removidos os links duplicados e ordenados pelo menor preço. Os scripts coletam até 50 itens; o endpoint da API retorna no máximo 10 por requisição.

O script do Mercado Livre também gera uma planilha Excel em `output/`.

## Tecnologias utilizadas

- **Node.js**: ambiente de execução;
- **TypeScript** com modo estrito: tipagem e compilação para `dist/`;
- **Playwright**: navegador Chromium automatizado para acessar e extrair as páginas;
- **Express 5**: servidor HTTP e endpoints da API;
- **SheetJS (`xlsx`)**: geração das planilhas do Mercado Livre;
- **ts-node**: execução direta dos arquivos TypeScript durante o desenvolvimento.

## Estrutura

```text
src/
  server.ts          API HTTP e interface web básica
  mercado-livre.ts   coletor do Mercado Livre e exportação XLSX
  amazon.ts          coletor da Amazon
  shein.ts           coletor da Shein
  shoppe.ts          coletor da Shopee
output/              planilhas geradas pelo Mercado Livre
```

## Instalação

Use Node.js compatível com TypeScript 5 e instale as dependências:

```bash
npm install
npx playwright install chromium
```

O repositório também declara Yarn 4 como gerenciador de pacotes. Escolha um gerenciador e mantenha o respectivo arquivo de lock atualizado.

## Execução

### Scripts de coleta

```bash
npm run ml -- "iphone 14"
npm run amazon -- "iphone 14"
npm run shein -- "vestido"
npm run shopee -- "iphone 14"
```

Amazon e Shein aceitam também uma URL completa de busca. O resultado é impresso no terminal; no Mercado Livre, a planilha é salva em `output/mercado-livre-<busca>-<data>.xlsx`.

### API HTTP

```bash
npm run dev
```

Por padrão, o servidor inicia em `http://localhost:3000`. Defina `PORT` para usar outra porta.

Endpoints:

- `GET /health`: verificação do servidor;
- `GET /`: interface web simples para chamar a busca;
- `POST /scrape`: recebe os parâmetros em JSON;
- `GET /scrape`: recebe os parâmetros pela query string.

Exemplo para o Mercado Livre:

```bash
curl -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{"niche":"tenis","site":"https://www.mercadolivre.com.br/","limit":10}'
```

Resposta:

```json
{
  "count": 1,
  "items": [
    {
      "title": "Produto",
      "link": "https://...",
      "price": 100,
      "discount": "10% OFF",
      "finalPrice": 90
    }
  ]
}
```

Para outros sites na API, informe `url` e os seletores CSS obrigatórios (`product`, `title`, `link` e `price`). O campo `discount` é opcional.



## Observações operacionais

- Os seletores e fluxos dependem das páginas externas; alterações nos marketplaces podem exigir manutenção.
- Shein e Shopee podem exibir captcha ou bloqueio. Execute com `HEADLESS=false`, conclua a verificação no navegador e mantenha o perfil local para reaproveitar a sessão.
- A coleta deve respeitar os termos de uso, limites e políticas de cada marketplace.

## Validação

```bash
npm run build
```

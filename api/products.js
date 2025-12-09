export default function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json([{ id: 1, name: 'Producto de ejemplo' }]);
  } else {
    res.status(405).end(); 
  }
}
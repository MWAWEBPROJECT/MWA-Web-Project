const express=require('express');

const jsonBody=express.json({limit:'32kb',inflate:false});

module.exports={jsonBody};

///////////////////////////////////////////////////////////////////////////
// Copyright © 2014 - 2017 Esri. All Rights Reserved.
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
///////////////////////////////////////////////////////////////////////////

define([
  'dojo/_base/declare',
  'dojo/_base/lang',
  'dojo/on',
  './Utils',
  'dojo/promise/all', //MJM
  'dojo/_base/array', //MJM
  'jimu/CSVUtils', //MJM
  'esri/tasks/BufferParameters', 'esri/tasks/GeometryService',  //MJM
  'dijit/TitlePane', //MJM - collapsible bar to hold details
  'esri/graphic',  //MJM
  'dijit/form/Button',  //MJM
  'esri/toolbars/draw', //MJM
  'esri/symbols/SimpleFillSymbol', //MJM
  'esri/geometry/geometryEngine',  //MJM
  'esri/tasks/query',  //MJM
  'esri/tasks/QueryTask',  //MJM
  'dojo/dom-construct',  //MJM
  'esri/symbols/SimpleFillSymbol',  //MJM
  'esri/symbols/SimpleLineSymbol',  //MJM
  'esri/symbols/SimpleMarkerSymbol',  //MJM
  'esri/Color',  //MJM
  'dijit/_WidgetsInTemplateMixin',
  'jimu/BaseWidget'
], function (declare, lang, on, legendUtils,
  all, array, CSVUtils, BufferParameters, GeometryService,
  TitlePane, Graphic, Button, Draw, SimpleFillSymbol, geometryEngine, Query, QueryTask, domConstruct,
  SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol, Color,
  _WidgetsInTemplateMixin, BaseWidget) {

  var clazz = declare([BaseWidget, _WidgetsInTemplateMixin], {
    name: 'Legend',
    baseClass: 'jimu-widget-legend',
    legend: null,
    _jimuLayerInfos: null,

    startup: function () {
      this.inherited(arguments);
      this._buildDrawSection();  //MJM - Add Draw section to panel
      this._buildDocumentSection();  //MJM - Add Permit History & Feature Drawings sections to panel
    },

    onOpen: function () {
      if (this.toolbar) {
        this.toolbar.activate(Draw['POINT']);  //MJM - enable map point draw ability
      }
    },

    onClose: function () {
      this.toolbar.deactivate();  //MJM - disable draw ability on widget close
    },

    //START MJM FUNCTIONS ------------------------------------------------------------------------------
    _buildDrawSection: function () {  //MJM - Draw & Query Results setup
      //GLOBAL VARIABLES (no var)
      myMapSR = this.map.spatialReference;
      currentAddressResults = [];  //Object to hold CSV records for Permit History
      currentStreetResults = [];  //Object to hold CSV records for Feature Drawings
      currentAllResults = [];  //Object to hold CSV records for Permit History & Feature Drawings
      highlightResults_Address = [];  //object to hold feature boundaries for highlighting - all other data
      highlightResults = [];  //object to hold feature boundaries for highlighting - all other data
      //Highlight graphic symbols
      symbol_Highlight = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([0, 0, 255]), 2), new Color([255, 255, 0, 0.25]));
      symbol_Highlight_Pt = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_SQUARE, 14,
        new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID,
          new Color([0, 0, 255]), 1),
        new Color([0, 0, 255, 0.25]));

      //Query layer - Parcel (base)
      qtParcel = new QueryTask("https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTparcels_PUBLIC/MapServer/4");  //ALL Parcels - To avoid the rare occasion when there is no base parcel
      qParcel = new Query();
      qParcel.returnGeometry = true;
      qParcel.outFields = ["TaxParcelNumber", "Site_Address"];  //Parcel return fields

      //Buffer parcel setup ----------------------------------
      esri.config.defaults.io.proxyUrl = "/website/DART/StaffMap/proxy/proxy.ashx";  //Public proxy page for large buffers (post) ---Geometry Service - may need proxy for larger polys
      esri.config.defaults.io.alwaysUseProxy = false;
      gsvc = new GeometryService("https://gis.cityoftacoma.org/arcgis/rest/services/Utilities/Geometry/GeometryServer");  //Can't use clent-side yet (esri/geometry/GeometryEngine) to buffer geometries with a geographic coordinate system other than WGS-84 (wkid: 4326)
      paramsBuffer = new BufferParameters();
      paramsBuffer.unionResults = true;  //Need one polygon for address point query task
      paramsBuffer.distances = [500]; //Required, but can be 0 - Using the buffer function to make on polygon out of many parcels
      paramsBuffer.bufferSpatialReference = new esri.SpatialReference({
        wkid: 102749  //Same as parcels
      });
      paramsBuffer.outSpatialReference = myMapSR;
      paramsBuffer.unit = esri.tasks.GeometryService["UNIT_FOOT"];
      //End Buffer parcel setup ------------------------------

      //START HERE - TRY IDENTIFY WITH 3,9
      //https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTzoning/MapServer/3  //Historic Properties
      //https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTzoning/MapServer/9  //Mixed Use Centers
      qtAddress = new QueryTask("https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTzoning/MapServer/3");  //Historic Properties
      qAddress = new Query();
      qAddress.returnGeometry = true;
      qAddress.outFields = ["P_NAME", "NOMINATION"];  //Return fields
      qAddress.orderByFields = ["P_NAME"];  //Sort field
      this.map.on("load", this._drawCreateToolbar());  //Create draw toolbar
      this.toolbar.activate(Draw['POINT']);  //Enable map point draw ability
    },

    _buildDocumentSection: function () {  //MJM - Results section setup
      var tpPermitHistory = new TitlePane({  //Results - put an id to dynamically update innerHTML with queries
        title: "<b>Results</b>",
        open: false,
        content: "<div id='addressQuery'></div>"
      });
      this.permitHistory.appendChild(tpPermitHistory.domNode);  //data-dojo-attach-point permitHistory
      tpPermitHistory.startup(); //place on page (waits for appendChild step)
    },

    _drawLimitArea: function () {  //MJM - Reset results to start over
      currentAddressResults = [];  //Empty out object to hold CSV records for Permit History
      currentStreetResults = [];  //Empty out object to hold CSV records for Feature Drawings
      currentAllResults = [];  //Empty out object to hold CSV records for Permit History & Feature Drawings
      this.map.graphics.clear(); //Remove all map graphics
      document.getElementById("addressQuery").innerHTML = ""; //Clear last address point query text - won't exist on intial start up
    },

    _drawCreateToolbar: function () {  //MJM - add drawing ability
      this.toolbar = new Draw(this.map);
      this.own(on(this.toolbar, "draw-end", lang.hitch(this, this._drawAddToMap))); //run after draw click
    },

    _drawAddToMap: function (evt) {  //MJM - Add graphic to map
      this._drawLimitArea();  //Clear previous results
      var graphic = new Graphic(evt.geometry, new SimpleFillSymbol());
      this.map.graphics.add(graphic);  //Add drawn polygon to map
      qParcel.geometry = graphic.geometry;  //Use graphic geometry for next query
      document.getElementById("addressQuery").innerHTML = "<div><img src='widgets/Buffer500/images/loading.gif'> Retrieving information ...</div>"; //Results Section: Add waiting image
      qtParcel.execute(qParcel, lang.hitch(this, this._handleQueryParcel), function (err) { console.error("Query Error: " + err.message); }); //PARCELS: Trigger a query by drawn polygon, use lang.hitch to keep scope of this, add error catch message
    },

    _handleQueryParcel: function (results) {  //MJM - Process parcel query results from drawn polygon
      //BUFFER - get parcel geometry first before next query | Use parcel boundaries instead of drawn polygon (more exact) | Assume parcel topologically correct - no need to simplify [geometry]
      if (results.features.length > 0) { //parcels found
        paramsBuffer.geometries = []; //Empty array to hold all parcel geometries
        for (var i = 0; i < results.features.length; i++) {
          paramsBuffer.geometries.push(results.features[i].geometry);  //add each parcel geometry to array
        }
        var bufferedGeometries = gsvc.buffer(paramsBuffer);  //BUFFER the parcels selected
        bufferedGeometries.then(lang.hitch(this, function (results) {  //Using dojo deferred 'then' function to set callback and errback functions
          //QC - Show buffer on map ----------------------------------------------------------
          var symbol = new SimpleFillSymbol();
          var sls = new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASH, new Color([255, 0, 0]), 3);
          symbol.setColor(new Color([100, 100, 100, 0.25]));
          symbol.setOutline(sls);
          var parcelGraphic = new Graphic(results[0], symbol);
          this.map.graphics.add(parcelGraphic);  //Add parcel buffer to map
          this.map.setExtent(parcelGraphic.geometry.getExtent(), true);  // Zoom to buffer extent
          //End QC  -----------------------------------------------------------------

          //Query historic properties with buffer polygon
          qAddress.geometry = parcelGraphic.geometry;  //Use graphic geometry for parcel & street query
          qtAddress.execute(qAddress, lang.hitch(this, this._handleQueryAddress), function (err) { console.error("Query Error: " + err.message); }); //Trigger a query by drawn polygon, use lang.hitch to keep scope of this, add error catch message
        }), lang.hitch(this, function (err) {
          alert("Error retrieving parcel results: " + err.message);
          console.error("Parcel Buffer Error: " + err.message);
        }));
      } else {  //no parcels found
        document.getElementById("addressQuery").innerHTML = 'No parcel found.<br>&nbsp;<br>'; //Update results details | Done here because this._handleQueryAddress will not be run if no parcels within drawn polygon
      }
    },

    _handleQueryAddress: function (results) {  //MJM - Address query results by parcel buffer (500') resulting from drawn polygon
      highlightResults = []; //object to hold feature boundaries for highlighting - empty out
      var highlightIDs = []; //object to hold create dom locations to run highlight boundary function for each layer
      var theFormattedResults = '';
      if (results.features.length == 0) {
        document.getElementById("addressQuery").innerHTML = 'No historic properties found within 500 feet.<br>&nbsp;<br>'; //Update Permit History details
      } else if (results.features.length == 1) {
        theFormattedResults += 'One historic property found within 500 feet of parcel ...<br>&nbsp;<br>'; //Update Permit History details
      } else {
        theFormattedResults += results.features.length + ' historic properties found within 500 feet of parcel ...<br>&nbsp;<br>'; //Update Permit History details
      }
      if (results.features.length > 0) {
        //Historic Properties
        for (var i = 0; i < results.features.length; i++) {
          theFormattedResults += "<a href=\"" + results.features[i].attributes['NOMINATION'] + "\" target=\"_blank\">Tacoma Register Original Nomination</a><br>for ";
          theFormattedResults += " <span id='Highlight_Address" + i + "'></span><br>&nbsp;<br>";
          highlightIDs.push(results.features[i].attributes['P_NAME']); //Add geometry info to array for link update later - update each layer highlight field - use later to place Highlight function
          highlightResults.push(results.features[i]); //update with results from each layer - contains geometry for highlighting
        }
        document.getElementById("addressQuery").innerHTML = theFormattedResults; //Update info panel
      }
      for (var i = 0; i < highlightIDs.length; i++) {  //Update field value with highlight function
        var list = dojo.byId("Highlight_Address" + i);  //Add dynamic highlight function to formatted text
        domConstruct.create("span", { innerHTML: "<i><span style='color: blue; cursor: pointer;' title='Highlight property'>" + highlightIDs[i] + "</span></i>" }, list);
        //Method to add click event  - Need this.own to maintain scope of dynamic text function within the popup; lang.hitch to keep scope of function within widget
        this.own(on(list, 'click', lang.hitch(this, this._showFeature, i, 'Address')));  //this.own(on(Node, 'click', lang.hitch(this, FUNCTION, param1, param2, etc)));
      }
    },

    _showFeature: function (featureNum, type) {  //MJM - highlights data item on map
      this._removeGraphic('identify');  //clear any identify graphic
      if (type == 'Address') {
        var feature = highlightResults[featureNum];  //object to hold feature boundaries for highlighting
      } else {
        var feature = highlightResults2[featureNum];  //object to hold feature boundaries for highlighting
      }
      if (feature.geometry.type == "point") {  //check if feature a point or other type
        feature.setSymbol(symbol_Highlight_Pt); //use marker symbol
      } else {
        feature.setSymbol(symbol_Highlight); //use default symbol
      }
      feature.geometry.spatialReference = myMapSR;  //Set feature's spatial reference so selected layer highlighted correctly
      feature.id = "identify";  //add id for later removal by id
      this.map.graphics.add(feature);  //add graphic to map
    },

    _removeGraphic: function (graphicID) {  //MJM - remove highlighted elements (named)
      dojo.forEach(this.map.graphics.graphics, function (g) {
        if (g && g.id === graphicID) {
          this.map.graphics.remove(g);  //remove graphic with specific id
        }
      }, this);
    },
    //END MJM FUNCTIONS ------------------------------------------------------------------------------

    _bindEvent: function () {
      if (this.config.legend.autoUpdate) {
        this.own(on(this._jimuLayerInfos,
          'layerInfosIsShowInMapChanged',
          lang.hitch(this, 'refreshLegend')));

        this.own(on(this._jimuLayerInfos,
          'layerInfosChanged',
          lang.hitch(this, 'refreshLegend')));

        this.own(on(this._jimuLayerInfos,
          'layerInfosRendererChanged',
          lang.hitch(this, 'refreshLegend')));
      }
    },

    _getLayerInfosParam: function () {
      var layerInfosParam;
      if (this.config.legend.layerInfos === undefined) {
        // widget has not been configed.
        layerInfosParam = legendUtils.getLayerInfosParam();
      } else {
        // widget has been configed, respect config.
        layerInfosParam = legendUtils.getLayerInfosParamByConfig(this.config.legend);
      }

      // filter layerInfosParam
      //return this._filterLayerInfsParam(layerInfosParam);
      return layerInfosParam;
    },

    refreshLegend: function () {
      var layerInfos = this._getLayerInfosParam();
      this.legend.refresh(layerInfos);
    }

  });
  return clazz;
});
